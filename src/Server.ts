import * as net from "net";
import { Socket } from "net";
import { EventEmitter } from "events";
import * as Long from "long";
import IsaacCipher from "./packets/IsaacCipher";
import { LoadMapZone73, UpdateLocalPlayer81 } from "./packets/outgoing";
import GameIds from "./GameIds";
import { ParsePacketOpcode, GetFixedPacketLength } from "./packets/incoming";

enum LoginState {
    FirstResponse,
    SecondResponse,
    LoggedIn
}

enum ConnectionStatus {
    NewSession = 14,
    Reconnecting = 16
}

enum ResponseCode {
    TryAgainFailure = -1,
    NewSession = 0,
    TryAgainFailure2 = 1,
    SuccessfulLogin = 2,
    InvalidUserOrPass = 3,
    AccountBanned = 4,
    AccountStillLoggedIn = 5,
    RuneScapeUpdated = 6,
    WorldFull = 7,
    ServerDown = 8,
    LoginLimit = 9,
    BadSessionID = 10,
    LoginRejected = 11,
    Memembers = 12,
    LoginFailure = 13,
    ServerUpdated = 14,
}

/**
 * Entry point for the server
 * @author ale8k
 */
class Server {
    /**
     * Handles the current state of our login procedure
     */
    private _loginState: LoginState = LoginState.FirstResponse;
    /**
     * In stream opcode isaac cipher
     */
    private _inStreamDecryption: IsaacCipher;
    /**
     * Out stream opcode isaac cipher
     */
    private _outStreamEncryption: IsaacCipher;
    /**
     * The emitter which handles directing incoming and outgoing packets
     */
    private _gameLoopEventEmitter: EventEmitter = new EventEmitter();
    /**
     * A place for us to store the incoming data outside of our
     * 600ms cycle
     */
    private _inStreamCacheBuffer: number[] = [];
    /**
     * Some kind of flag to ensure that our emitter call back is added once
     * and our initial packets are sent once...
     */
    private _gameInitialSetupComplete = false;
    /**
     * Sets the game cycle rate (600 default)
     */
    private _gameCycleRate = 600;
    /**
     * The players ID from the RSA login block
     */
    private _playerId: number;

    public startServer(): void {
        net.createServer((socket: Socket) => {
            console.log("A Client is attempting to establish a connection...");

            /**
             * Single primary data event
             */
            socket.on("data", (data) => {

                if (this._loginState === LoginState.FirstResponse) {
                    const b = Buffer.alloc(17);
                    b[16] = 69;
                    socket.write(b);
                    this._loginState = LoginState.SecondResponse;
                    console.log("First client request received and first server response sent");
                } else if (this._loginState === LoginState.SecondResponse) {
                    const rsaBlock = data.toJSON().data.slice(43);
                    const clientSessionKey = Long.fromBytes(rsaBlock.slice(1, 9));
                    const serverSessionKey = Long.fromBytes(rsaBlock.slice(9, 17));
                    // set player id
                    this._playerId = rsaBlock[17];
                    console.log("USERID: ", rsaBlock[17]);

                    const inSessionKey = [
                        (clientSessionKey.shiftRight(32).toInt()),
                        (clientSessionKey.toInt()),
                        (serverSessionKey.shiftRight(32).toInt()),
                        (serverSessionKey.toInt())
                    ];

                    const sessionKey = [
                        (clientSessionKey.shiftRight(32).toInt()) + 50,
                        (clientSessionKey.toInt()) + 50,
                        (serverSessionKey.shiftRight(32).toInt()) + 50,
                        (serverSessionKey.toInt()) + 50
                    ];

                    this._inStreamDecryption = new IsaacCipher(inSessionKey);
                    this._outStreamEncryption = new IsaacCipher(sessionKey);
                    /**
                     * We're happy with logging the user in, so setup game tick
                     * and send A-OK response
                     */
                    setInterval(() => {
                        this._gameLoopEventEmitter.emit("tick");
                    }, this._gameCycleRate);
                    socket.write(Buffer.from([2, 0, 0]));
                    this._loginState = LoginState.LoggedIn;
                    console.log("Second client request received and second server response sent");

                } else if (this._loginState === LoginState.LoggedIn) {
                    /**
                     * Set up the initial game tick callback and send initial packets once
                     * otherwise just push all incoming data into the instream cache
                     * // We're done here now
                     */
                    if (this._gameInitialSetupComplete === false) {
                        console.log("Setting up initial game stage!");
                        // Push the very first game packet to our cache buffer
                        this._inStreamCacheBuffer.push(...data.toJSON().data);
                        // setup event listener and send initial packets
                        this.setupGame(socket);
                    } else {
                        this._inStreamCacheBuffer.push(...data.toJSON().data);
                    }

                }
            });

            /**
             * Close
             */
            socket.on("close", (e) => {
                console.log("A client was disconnected...");
            });

        }).listen(43594, () => {
            console.log("Server running");
        });
    }

    /**
     * Sends initial packets and adds our gameloop
     * event listener callback
     * The inStreamBuffer cache increments based on all incoming data
     * @param socket the primary socket
     */
    private setupGame(socket: Socket): void {
        this._gameLoopEventEmitter.on("tick", () => {
            console.log("Current cache buffer state: ", this._inStreamCacheBuffer);
            /**
             * This works by removing the packet from the start
             * of the inStreamBuffer[], and then continues to read until the
             * buffer is empty.
             */
            // so, we got the buffer full of packets...
            // let's ensure its actually got stuff in
            while (this._inStreamCacheBuffer.length > 0) {
                /**
                 * Packet 210 expects data? Apparently?
                 */
                // Grab the first index of our cache buffer
                // (which will always be the opcode! See below as to why)
                const eOpcode = this._inStreamCacheBuffer[0];
                // Parse the opcode
                const dOpcode = ParsePacketOpcode(eOpcode, this._inStreamDecryption);
                let pLength;
                // check if its variable length packet, if not just set the fixed length
                switch (dOpcode) {
                    // Sent when a player enters a chat message
                    case 4:
                    case 36:
                    case 45:
                    // Sometimes sends this on idle, I just set length to something big
                    // enough such that it cleans the buffer for us
                    case 77:
                    // Walk on command: Sent when player walks due to clicking a door or something
                    case 98:
                    // Command in chatbox, i.e., ::something
                    case 103:
                    // Sent when dude sends private message
                    case 126:
                    // Sent when player clicks a tile to walk normally
                    case 164:
                    case 165:
                    // Sometimes sends this on idle, I just set length to something big
                    // enough such that it cleans the buffer for us
                    case 226:
                    case 246:
                    // Sent when player walks using map (note, it has 14 additional bytes on the end
                    // presumed to be anticheat that are ignored)
                    case 248:
                        // We just force them to end for now
                        pLength = 69999;
                        break;
                    default:
                        pLength = GetFixedPacketLength(dOpcode);
                }
                console.log("Opcode for this packet: ", dOpcode, "Packet length: ", pLength);
                // Remove this packet from the in stream buffer,
                // eventually we'll put it into another buffer that'll respond based
                // on the packet
                for (let i = 0; i < (pLength); i++) {
                    this._inStreamCacheBuffer.shift();
                }

            }
            // General packet cycle
            // 81: Update our player
            socket.write(
                UpdateLocalPlayer81(
                    this._outStreamEncryption.nextKey(),
                    1, // update our player
                    3, // move type
                    0, // planelevel
                    1, // clear await queuee
                    0, // update required - declares whether or not a bitmask should be read, good shit
                    21, // ycoord
                    21,  // xcoord
                    0, // updateNPlayers movements - always skip this
                    2047, // player list updating bit - always skip this
                    // bit masks now because update required = 1
                    // the bit masks are only read if that is 11
                )
            );
        });

        this.sendInitialLoginPackets(socket);
        console.log("Callback attached and initial packets sent");
        this._gameInitialSetupComplete = true;
    }

    /**
     * Sends all the essential starting packets
     * @param socket our players socket
     */
    private sendInitialLoginPackets(socket: Socket): void {
        let b = Buffer.alloc(0);
        // 249: Sends mem status and player's index in servers playerlist to client
        b = Buffer.alloc(4);
        b[0] = 249 + this._outStreamEncryption.nextKey();
        b[1] = 1 + 128; // one of them -128 removes on client end
        // rest of it is a short accepting our id, but its also got that -128 on client side
        // again. Really frustrating
        b[2] = (this._playerId + 128);
        b[3] = (this._playerId >> 8);
        socket.write(b);
        console.log("Player index sent to client");

        // 71: Set sidebar interface (fixed 4 bytes)
        GameIds.SIDEBAR_IDS.forEach((sideBarIconId, sideBarLocationId) => {
            const b = Buffer.alloc(4);
            b[0] = 71 + this._outStreamEncryption.nextKey();
            b.writeInt16BE(sideBarIconId, 1);
            b[3] = sideBarLocationId + 128;
            socket.write(b);
        });

        // 134: Set/Update(?) skill level // sets them all for some reason... :D
        // need to play with this more... (i.e., update just 1)
        b = Buffer.alloc(7);
        new Array(10).fill(0).forEach((zero, i) => {
            b[0] = 134 + this._outStreamEncryption.nextKey();
            b[1] = i;
            // the client reads skill xp updates like this
            b[2] = (0 >> 8);
            b[3] = (0);
            b[4] = (0 >> 24);
            b[5] = (0 >> 16);
            // skill level?
            b[6] = 5;
            socket.write(b);
        });

        // 221: Update friends list status
        b = Buffer.alloc(2);
        b[0] = 221 + this._outStreamEncryption.nextKey();
        b[1] = 2; // 1 doesn't work, idk why, but 2 loads them
        socket.write(b);

        // 107: Reset camera position
        b = Buffer.alloc(1);
        b[0] = 107 + this._outStreamEncryption.nextKey();
        socket.write(b);

        // 73: Load the map zone (fixed)
        socket.write(
            LoadMapZone73(
                this._outStreamEncryption.nextKey(),
                406, // higher = east, lower = west  // x
                406 // higher = north, lower = south // y coord
            )
        );

        // 81: Update our player
        socket.write(
            UpdateLocalPlayer81(
                this._outStreamEncryption.nextKey(),
                1, // update our player
                3, // move type
                0, // planelevel
                1, // clear await queuee
                1, // update required - declares whether or not a bitmask should be read, good shit
                21, // ycoord
                21,  // xcoord
                0, // updateNPlayers movements - always skip this
                2047, // player list updating bit - always skip this
                // bit masks now because update required = 1
                // the bit masks are only read if that is 11
            )
        );

        // 253: Welcome to rs!
        const text = Buffer.from(" Welcome to DevisleScape! \n").toJSON().data;
        b = Buffer.alloc(text.length + 2);
        b[0] = 253 + this._outStreamEncryption.nextKey();
        b[1] = text.length;
        let textOffset = 2;
        text.forEach(byte => {
            b[textOffset++] = text[(textOffset - 2)];
        });
        console.log("Text buffer", b.toJSON());
        socket.write(b);
    }

}

new Server().startServer();

