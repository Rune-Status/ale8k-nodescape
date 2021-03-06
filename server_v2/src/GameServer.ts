import LoginHandler from "./handlers/LoginHandler";
import Client from "./game/entities/Client";
import Player from "./game/entities/game/Player";
import { Server } from "net";
import { EventEmitter } from "events";
import { Subject } from "rxjs";
import PacketReader from "./game/packets/PacketReader";
import IPacket from "./game/packets/interfaces/IPacket";
import PacketWriter from "./game/packets/PacketWriter";
/**
 * Entry point
 * @author ale8k
 */
export default class GameServer {
    /**
     * The server instance reference
     */
    private readonly SERVER = new Server();
    /**
     * Game tick rate
     */
    private readonly GAME_CYCLE_RATE = 600;
    /**
     * Contains an index for each connection that comes in
     */
    private readonly PLAYER_INDEX: Set<number> = new Set<number>();
    /**
     * The player store, corresponding it's index to the PLAYER_INDEX value.
     */
    private readonly PLAYER_LIST: Player[] = new Array<Player>(2047);
    /**
     * Game cycle subject
     * I think async subject be more appropriate, test it Alex
     */
    private readonly _gameCycle$: Subject<string> = new Subject<string>();

    /**
     * Please note:
     *  All variables created within a connection even call back persist
     *  for the length of that connection
     */
    constructor() {
        // TURN GAME CYCLE ON
        this.startGameCycle(this.GAME_CYCLE_RATE, this._gameCycle$);

        // CONNECTION
        this.SERVER.on("connection", (socket) => {
            console.log("A client is attempting to connect...");
            const clientEmitter$: EventEmitter = new EventEmitter();
            const client: Client = new Client(socket);
            new LoginHandler(client, clientEmitter$);

            // LOGGED IN
            clientEmitter$.on("successful-login", (player: Player) => {
                this.updatePlayerIndex(player); // Adds our local players index to the index list
                this.collectGamePackets(player); // Pushes all incoming data for our local players socket into their buffer
                PacketWriter.sendInitialPackets(player, this.PLAYER_LIST, this.PLAYER_INDEX);
                this.PLAYER_LIST[player.localPlayerIndex] = player; // Adds our local player inst object to the servers player list
                let decryptedPackets: IPacket[];

                // GAME CYCLE
                const playerSub = this._gameCycle$.subscribe(() => {
                    // Decrypt all packets in our buffer and store them here
                    decryptedPackets = PacketReader.getDecryptedPackets(player);
                    // Packet writer responds to all packets in the packet buffer
                    PacketWriter.respondToPackets(decryptedPackets, player, this.PLAYER_LIST, this.PLAYER_INDEX,);
                });

                // LOGGED OUT
                player.socket.on("close", () => {
                    playerSub.unsubscribe();
                    this.PLAYER_INDEX.delete(player.localPlayerIndex);
                    // todo, figure a way to remove players from the playerlist without use of undefined.
                    console.log("Client disconnected and unsubscribed to gamecycle....");
                });
            });

        });
        // CLOSE
        this.SERVER.on("close", () => {
            console.log("Server closed...");
        });
    }

    /**
     * Start method for the server
     */
    public startServer(): void {
        this.SERVER.listen(43594, () => {
            console.log("Server listening on port 43594");
        });
    }

    /**
     * This represents our game loop, and allows sockets to subscribe briefly
     * @param {number} cycleRate The cycle rate to read/respond to packets at
     * @param {Subject<string>} cycleSubject the subject to emit to in which our players will subscribe
     */
    private startGameCycle(cycleRate: number, cycleSubject: Subject<string>): void {
        setInterval(() => {
            cycleSubject.next("tick");
        }, cycleRate);
    }

    /**
     * Updates the PLAYER_INDEX with this local players index
     * @param {Player} player the local player
     */
    private updatePlayerIndex(player: Player): void {
        player.localPlayerIndex = this.getNextConnectionIndex();
        this.PLAYER_INDEX.add(player.localPlayerIndex);
    }

    /**
     * Adds the next index to the PLAYER_INDEX
     * It checks if there's any gaps between 0-2047 and fills them
     * This would be a usecase for when a player logsout.
     * @returns {number} the next index a player can be indexed at upon connection
     */
    private getNextConnectionIndex(): number {
        const maxPlayers = 2046;
        if (this.PLAYER_INDEX.size === 0) {
            return 0;
        } else {
            for (let i = 0; i < maxPlayers; i++) {
                if (!this.PLAYER_INDEX.has(i)) {
                    return i;
                }
            }
        }
        return 2047;
    }

    /**
     * Sets up the listener which listens for incoming packets
     * and stores them in the players packetBuffer (it's actually an array lol)
     * @param {Player} player local player
     */
    private collectGamePackets(player: Player): void {
        player.socket.on("data", (data) => {
            player.packetBuffer.push(...data.toJSON().data);
        });
    }

    /**
     * Gets the other indexes currently connected, i.e., it skips our local players
     * @param {Set<number>} playerIndexList the total index list for the server
     * @param {Player} player local player, used to compare this players indexes vs others
     * @return {number[]} the total amount of connected indexes (excluding our player)
     */
    private getConnectedIndexes(playerIndexList: Set<number>, player: Player): number[] {
        const otherPlayerList: number[] = [];
        playerIndexList.forEach((v, v2, s) => {
            if (v !== player.localPlayerIndex) {
                otherPlayerList.push(v);
            }
        });
        return otherPlayerList;
    }

}

new GameServer().startServer();
