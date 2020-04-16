import * as net from "net";
import { Socket } from "net";
import { EventEmitter } from "events";
import IsaacCipher from "./packets/IsaacCipher";
import {
    SetSidebarInterface71,
    LoadMapZone73,
    UpdateLocalPlayer81,
    ResetCamPos107,
    SetSkillLevelAndXp134,
    EnableFriendsList221,
    SendPlayerIdx249,
    WriteMessage253
} from "./packets/outgoing";
import GameIds from "./GameIds";
import { PacketReader, Parse164Walk } from "./packets/incoming";
import { LoginState } from "./enums/Login.enum";
import LoginHandler from "./packets/login/LoginHandler";
import IMovement, { movementData3, movementData1 } from "./packets/outgoing/81/interfaces/IMovement";
// DEBUG
import { colours } from "./ConsoleColours";

/**
 * Entry point for the server
 * @author ale8k
 */
export default class Server {
    /**
     * Handles the current state of our login procedure
     */
    public static LOGIN_STATE: LoginState = LoginState.FirstResponse;
    /**
     * In stream opcode isaac cipher (set by loginhandler)
     */
    public static INSTREAM_DECRYPTION: IsaacCipher;
    /**
     * Out stream opcode isaac cipher (set by loginhandler)
     */
    public static OUTSTREAM_ENCRYPTION: IsaacCipher;
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
    public static GAME_CYCLE_RATE = 600;
    /**
     * The players ID from the RSA login block
     */
    public static PLAYER_ID: number;

    /**
     * DEBUG X/Y region X/Y
     * Also 'moving' flag, cause I think we need to send
     * a variable kind of 81 and not just 81, idle, 81, idle
     * or 81, 81, 81, 81, idle in one big go. I think it wants one on the 600ms
     * cycle
     */
    private x: number = 42;
    private y: number = 47;
    private regionx = 2944;
    private regiony = 3328;


    public startServer(): void {
        net.createServer((socket: Socket) => {
            console.log("A Client is attempting to establish a connection...");

            /**
             * Single primary data event
             */
            socket.on("data", (data) => {
                if (Server.LOGIN_STATE === LoginState.FirstResponse) {
                    LoginHandler.sendFirstResponse(socket);
                } else if (Server.LOGIN_STATE === LoginState.SecondResponse) {
                    LoginHandler.sendSecondResponse(socket, data, this._gameLoopEventEmitter);
                } else if (Server.LOGIN_STATE === LoginState.LoggedIn) {

                    // Basics we need to setup before generically handling packets
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
        const oe = Server.OUTSTREAM_ENCRYPTION;

        let packet: { opcode: number, length: number, payload: number[] };

        let destinationX = this.x;
        let destinationY = this.y;
        let packet164: {
            opcode: number;
            baseXwithX: number;
            baseYwithY: number;
            bytes: number[];
            randomByteOnTheEndLol: number;
        };

        let playerIsMoving = false;
        let pathingActive = false;
        let pathingArr: number[] = [];

        const idleMovement: IMovement = {
            updatePlayer: 0,
            movementType: 0
        };

        const movement: IMovement = {
            updatePlayer: 1,
            movementType: 1,
            movementData: {
                updateRequired: 0,
                direction: 0
            }
        };
        movement.movementData = movement.movementData as movementData1;

        this._gameLoopEventEmitter.on("tick", () => {
            /**
             * This works by removing the packet from the start
             * of the inStreamBuffer[], and then continues to read until the
             * buffer is empty.
             */
            while (this._inStreamCacheBuffer.length > 0) {
                // debug
                const eOpcode = this._inStreamCacheBuffer[0];
                // Gets the packetopcode, length, returns the packet and wipes the buffer
                packet = PacketReader.getPacketOpcodeAndLength(this._inStreamCacheBuffer, Server.INSTREAM_DECRYPTION);
                // debug
                //console.log("Encrypted opcode: ", eOpcode, "Decrypted opcode: ", packet.opcode);

            }

            /**
             * WALKING MOVEMENT
             */
            // temp hardcode 164 handling
            if (packet.opcode === 164) {
                packet164 = Parse164Walk(packet);
                // ok so we need these anyway
                // so we let this path resolve but then
                // push each x/y from the byte array over gradually
                // until theyre complete.
                // the good bit about this is if a new 164 comes in, we can just
                // clear the pathArr and let them go to their new co-ord
                // rather than if this, if that etc which sucks donky dick
                if (packet164.bytes.length === 0) {
                    destinationX = packet164.baseXwithX - this.regionx;
                    destinationY = packet164.baseYwithY - this.regiony;
                } else {
                    console.log(colours.Reset, colours.FgWhite + "Pathing arr updated");
                    // turn pathing on
                    pathingActive = true;

                    // !! decided we gonna calc each of them here and now
                    pathingArr = packet164.bytes.map((coord, i) => {
                        return i % 2 === 0 ? coord + this.x & 0xff : coord + this.y & 0xff;
                    });

                }
                playerIsMoving = true;
            }

            /**
             * Walking block, refactor later
             */
            if (playerIsMoving) {
                console.log(colours.Reset, "Current x: ", colours.FgBlue + this.x, colours.Reset, "Current y: ", colours.FgBlue + this.y);
                // this is where we need to handle which destination will be present at a time
                // until ofcourse the pathingArr is empty
                if (pathingActive === true) {
                    console.log(colours.Reset, "164X: ", packet164.baseXwithX - this.regionx, "164Y: ", packet164.baseYwithY - this.regiony);
                    console.log(colours.Reset, "Path coords: ", pathingArr);
                    console.log(" Random byte is: ", colours.FgRed + packet164.randomByteOnTheEndLol);

                }
                console.log(colours.Reset, "");

                /**
                 * Depending on what P164 give us, this may be a straight
                 * linear dX and dY, otherwise it may be a pathed dX dY which dynamically updates
                 * upon arriving at a new path destination.
                 */
                // top left
                if (this.x > destinationX && this.y < destinationY) {
                    console.log(colours.FgCyan, "Top left");
                    this.x--;
                    this.y++;
                    console.log("Our x: ", this.x, "Our y:", this.y);
                    console.log("Des x: ", destinationX, "Des y:", destinationY);
                    // the bytes in packet 164 are needed to handle this some how!!
                    (movement.movementData as movementData1).direction = 0;
                    UpdateLocalPlayer81(socket, oe.nextKey(), movement, 0, 2047);
                    // bottom right
                } else if (this.x < destinationX && this.y > destinationY) {
                    console.log("Bottom right");
                    this.x++;
                    this.y--;
                    console.log("Our x: ", this.x, "Our y:", this.y);
                    console.log("Des x: ", destinationX, "Des y:", destinationY);
                    // the bytes in packet 164 are needed to handle this some how!!
                    (movement.movementData as movementData1).direction = 7;
                    UpdateLocalPlayer81(socket, oe.nextKey(), movement, 0, 2047);
                    // top right
                } else if (this.x < destinationX && this.y < destinationY) {
                    console.log("Top right");
                    this.x++;
                    this.y++;
                    // the bytes in packet 164 are needed to handle this some how!!
                    (movement.movementData as movementData1).direction = 2;
                    UpdateLocalPlayer81(socket, oe.nextKey(), movement, 0, 2047);
                    // bottom left
                } else if (this.x > destinationX && this.y > destinationY) {
                    console.log(colours.FgCyan, "Bottom left");
                    this.x--;
                    this.y--;
                    console.log(colours.FgCyan, "Our x: ", this.x, "Our y:", this.y);
                    console.log(colours.FgCyan, "Des x: ", destinationX, "Des y:", destinationY);
                    // the bytes in packet 164 are needed to handle this some how!!
                    (movement.movementData as movementData1).direction = 5;
                    UpdateLocalPlayer81(socket, oe.nextKey(), movement, 0, 2047);
                    // right
                } else if (this.x < destinationX && this.y === destinationY) {
                    console.log(colours.FgCyan, "Right");
                    this.x++;
                    (movement.movementData as movementData1).direction = 4;
                    UpdateLocalPlayer81(socket, oe.nextKey(), movement, 0, 2047);
                } else if (this.x > destinationX && this.y === destinationY) {
                    console.log(colours.FgCyan, "Left");
                    this.x--;
                    (movement.movementData as movementData1).direction = 3;
                    UpdateLocalPlayer81(socket, oe.nextKey(), movement, 0, 2047);
                    // top
                } else if (this.y < destinationY && this.x === destinationX) {
                    console.log(colours.FgCyan, "Top");
                    this.y++;
                    (movement.movementData as movementData1).direction = 1;
                    UpdateLocalPlayer81(socket, oe.nextKey(), movement, 0, 2047);
                    // bottom
                } else if (this.y > destinationY && this.x === destinationX) {
                    console.log(colours.FgCyan, "Bottom");
                    this.y--;
                    (movement.movementData as movementData1).direction = 6;
                    UpdateLocalPlayer81(socket, oe.nextKey(), movement, 0, 2047);
                }

                // handle region update
                // if they within 16 tiles of edge of region,
                // reload next one they closest to
                // if (false) {

                // }
                if (this.x === destinationX && this.y === destinationY) {
                    playerIsMoving = false;
                }
                console.log(colours.FgMagenta, "Walking packet sent");
            } else {
                console.log(colours.FgGreen, "Idle packet sent");
                UpdateLocalPlayer81(socket, oe.nextKey(), idleMovement, 0, 2047);
            }

        });

        this.sendInitialLoginPackets(socket);
        console.log("Callback attached and initial packets sent");
        this._gameInitialSetupComplete = true;
    }

    /**
     * Sends all the essential starting packets
     * @param s our players socket
     */
    private sendInitialLoginPackets(s: Socket): void {
        const oe = Server.OUTSTREAM_ENCRYPTION;

        // 249: Send player idx and mem status
        SendPlayerIdx249(oe.nextKey(), s, Server.PLAYER_ID);
        console.log("Player index sent to client");

        // 71: Set sidebar interface (fixed 4 bytes)
        GameIds.SIDEBAR_IDS.forEach((sideBarIconId, sideBarLocationId) => {
            SetSidebarInterface71(oe.nextKey(), s, sideBarLocationId, sideBarIconId);
        });

        // 134: Set/Update skill level and xp
        new Array(20).fill(0).forEach((zero, i) => {
            SetSkillLevelAndXp134(oe.nextKey(), s, i, 13700000, 99);
        });

        // 221: Update friends list status
        EnableFriendsList221(oe.nextKey(), s);

        // 107: Reset camera position
        ResetCamPos107(oe.nextKey(), s);

        // 73: Load the map zone (fixed)
        LoadMapZone73(oe.nextKey(), s, this.regionx, this.regiony);

        // 253: Welcome to rs!
        WriteMessage253(oe.nextKey(), s, "Welcome to Runescape!");

        // We send move type 3 to setup the plane the players
        // currently on (i.e., they could log out on plane1)
        // and 0x10 mask to get their view.
        const initialMovement: IMovement = {
            updatePlayer: 1,
            movementType: 3,
            movementData: {
                plane: 0,
                teleport: 1,
                updateRequired: 1,
                x: this.x,
                y: this.y
            } as movementData3
        };

        // 81: Update our player
        // General packet cycle
        // 81: Update our player
        // socket: Socket,
        // key: number,
        // movement: IMovement,
        // updateOthersMovements: number,
        // updateOthersMask: number,
        // maskId?: number,
        // maskData?: object
        UpdateLocalPlayer81(s, oe.nextKey(), initialMovement, 0, 2047);

    }

    /**
     * TEST
     */
    // lets try put it in a buffer...
    public readLEShortA(val1: number, val2: number) {
        // const test = Buffer.alloc(4);
        // test[0] = ((val1 & 0xff) << 8);
        // test[1] = (val2 - 128 & 0xff);
        // let converted = test.readUInt16BE(0);
        let converted = ((val1 & 0xff) << 8) + (val2 - 128 & 0xff);
        if (converted > 32767) {
            converted -= 0x10000;
        }
        return converted;
    }

    public readLEShort(val1: number, val2: number) {
        // const test = Buffer.alloc(4);
        // test[0] = ((val1 & 0xff) << 8);
        // test[1] = (val2 & 0xff);
        // let converted = test.readUInt16LE(0);
        let converted = ((val1 & 0xff) << 8) + (val2 & 0xff);
        if (converted > 32767) {
            converted -= 0x10000;
        }
        return converted;
    }

}

new Server().startServer();

