/************************/
/* Set up the http server library */
let http = require('http');

/* Set up the static file server */
let static = require('node-static');

/* Assume that we are running on Heroku */
let port = process.env.PORT || 8081;
let directory = __dirname + '/public';

/* If we aren't on Heroku, then we need to adjust our port and directory */
if ((typeof port == 'undefined') || (port === null)){
    port = 8081;
    directory = './public';
}

/* Set up our static file web server to deliver files from the filesystem */
let file = new static.Server(directory);

let app = http.createServer(
    function(request, response){
        request.addListener('end',
            function(){
                file.serve(request, response);
            }
        ).resume();
    }

).listen(port);

console.log('The server is running' + port);


/*****************************/
/* Set up the web socket server */

/* Set up a registry of player information and their socket ids */
let players = [];

const { Server } = require("socket.io");
const io = new Server(app);

io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    /* Output a log message on the server and send it to the clients */
    function serverLog(...messages){
        io.emit('log',['**** Message from the server:\n']);
        messages.forEach((item) => {
            io.emit('log', ['****\t'+item]);
            console.log(item);
        });
    }

    serverLog('A page connected to the server: ' + socket.id);

    /* join_room command handler */
    socket.on('join_room', (payload) => {
        serverLog('IN join room');
        serverLog('Server received a command', '\'join_room\'', JSON.stringify(payload));

        /* Check that the data is coming from the client is good */
        if ((typeof payload == 'undefined') || (payload === null)){
            const response = {
                result: 'fail',
                message: 'Client did not send a payload'
            };
            socket.emit('join_room_response', response);
            serverLog('join_room command failed', JSON.stringify(response));
            return;
        }

        let room = payload.room;
        let username = payload.username;

        if ((typeof room == 'undefined') || (room === null)){
            const response = {
                result: 'fail',
                message: 'Client did not send a valid room to join'
            };
            socket.emit('join_room_response', response);
            serverLog('join_room command failed', JSON.stringify(response));
            return;
        }

        if ((typeof username == 'undefined') || (username === null)){
            const response = {
                result: 'fail',
                message: 'Client did not send a valid username to join the chat room'
            };
            socket.emit('join_room_response', response);
            serverLog('join_room command failed', JSON.stringify(response));
            return;
        }

        /* Handle the command */
        socket.join(room);

        /* Make sure the client was put in the room */
        io.in(room).fetchSockets().then((sockets) => {
            /* Sockets didn't join the room */
            if ((typeof sockets == 'undefined') || (sockets === null) || !sockets.includes(socket)){
                const response = {
                    result: 'fail',
                    message: 'Server internal error joining chat room'
                };
                socket.emit('join_room_response', response);
                serverLog('join_room command failed', JSON.stringify(response));
            } else {
                if (typeof players[socket.id] === 'undefined') {
                    players[socket.id] = {}; // Initialize if not already defined
                }
                players[socket.id].username = username;
                players[socket.id].room = room;
                console.log('Players:', players);

                /* Announce to everyone that is in the room, who else is in the room */
                sockets.forEach((member) => {
                    const response = {
                        result: 'success',
                        socket_id: member.id,
                        room: players[member.id]?.room,
                        username: players[member.id]?.username,
                        count: sockets.length
                    };
                    /* Tell everyone that a new user has joined the chat room */
                    console.log('join_room_response:', response);
                    io.of('/').to(room).emit('join_room_response', response);
                    serverLog('join_room succeeded', JSON.stringify(response));
                    if (room !== "Lobby") {
                        send_game_update(socket,room,'initial update');
                    }
                });
            }
        }).catch((error) => {
            serverLog('Error fetching sockets:', error);
        });
    });


    /* invite command handler */
    socket.on('invite', (payload) => {
        serverLog('Server received a command', '\'invite\'', JSON.stringify(payload));
        /* Check that the data is coming from the client is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            const response = {
                result: 'fail',
                message: 'Client did not send a payload'
            };
            socket.emit('invite_response', response);
            serverLog('invite command failed', JSON.stringify(response));
            return;
        }
        let requested_user = payload.requested_user;
        let room = players[socket.id].room;
        let username = players[socket.id].username;
        if ((typeof requested_user == 'undefined') || (requested_user === null) || (requested_user === "")){
            const response = {
                result: 'fail',
                message: 'Client did not request a valid user to invite to play'
            };
            socket.emit('invite_response', response);
            serverLog('invite command failed', JSON.stringify(response));
            return;
        }

        if ((typeof room == 'undefined') || (room === null) || (room === "")){
            const response = {
                result: 'fail',
                message: 'The user that was invited is not in a room'
            };
            socket.emit('invite_response', response);
            serverLog('invite command failed', JSON.stringify(response));
            return;
        }

        if ((typeof username == 'undefined') || (username === null) || (username == "")){
            const response = {
                result: 'fail',
                message: 'The user that was invited does not have a name registered'
            };
            socket.emit('invite_response', response);
            serverLog('invite command failed', JSON.stringify(response));
            return;
        }

        /* Make sure that the invited player is present */
        io.in(room).allSockets().then((sockets) => {
            /* Sockets didn't join the room */
            if ((typeof sockets == 'undefined') || (sockets === null) || !sockets.has(requested_user)){
                response = {
                    result: 'fail',
                    message: 'The user that was invited is no longer in the room'
                };
                socket.emit('invite_response', response);
                serverLog('invite command failed', JSON.stringify(response));
                return;
            } 
            
            /* Invitee is in the room */
            else {
                response = {
                    result: 'success',
                    socket_id: requested_user,
                    message: 'The user that was invited is no longer in the room'
                };
                socket.emit("invite_response", response);
                response = {
                    result: 'success',
                    socket_id: socket.id,
                    message: 'The user that was invited is no longer in the room'
                };
                socket.to(requested_user).emit("invited", response);
                serverLog('invite command succeeded', JSON.stringify(response));
            }
        });
    });

    socket.on('uninvited', (payload) => {
        serverLog('Server received a command', '\'invite\'', JSON.stringify(payload));
        /* Check that the data is coming from the client is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            const response = {
                result: 'fail',
                message: 'Client did not send a payload'
            };
            socket.emit('uninvited_response', response);
            serverLog('uninvited command failed', JSON.stringify(response));
            return;
        }
        let requested_user = payload.requested_user;
        let room = players[socket.id].room;
        let username = players[socket.id].username;
        if ((typeof requested_user == 'undefined') || (requested_user === null) || (requested_user === "")){
            const response = {
                result: 'fail',
                message: 'Client did not request a valid user to uninvite to play'
            };
            socket.emit('uninvited_response', response);
            serverLog('uninvited command failed', JSON.stringify(response));
            return;
        }

        if ((typeof room == 'undefined') || (room === null) || (room === "")){
            const response = {
                result: 'fail',
                message: 'The user that was uninvited is not in a room'
            };
            socket.emit('uninvited_response', response);
            serverLog('uninvited command failed', JSON.stringify(response));
            return;
        }

        if ((typeof username == 'undefined') || (username === null) || (username == "")){
            const response = {
                result: 'fail',
                message: 'The user that was uninvited does not have a name registered'
            };
            socket.emit('uninvited_response', response);
            serverLog('uninvited command failed', JSON.stringify(response));
            return;
        }

        /* Make sure that the invited player is present */
        io.in(room).allSockets().then((sockets) => {
            /* Uninvitee isn't in the room */
            if ((typeof sockets == 'undefined') || (sockets === null) || !sockets.has(requested_user)){
                response = {
                    result: 'fail',
                    message: 'The user that was uninvited is no longer in the room'
                };
                socket.emit('uninvite_response', response);
                serverLog('uninvited command failed', JSON.stringify(response));
                return;
            } 
            
            /* Uninvitee is in the room */
            else {
                response = {
                    result: 'success',
                    socket_id: requested_user,
                };
                socket.emit("uninvite_response", response);
                
                response = {
                    result: 'success',
                    socket_id: socket.id,
                };
                socket.to(requested_user).emit("uninvited", response);
                serverLog('uninvited command succeeded', JSON.stringify(response));
            }
        });
    });

    socket.on('game_start', (payload) => {
        serverLog('Server received a command', '\'game_start\'', JSON.stringify(payload));
        /* Check that the data is coming from the client is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            const response = {
                result: 'fail',
                message: 'Client did not send a payload'
            };
            socket.emit('game_start_response', response);
            serverLog('game_start command failed', JSON.stringify(response));
            return;
        }
        let requested_user = payload.requested_user;
        let room = players[socket.id].room;
        let username = players[socket.id].username;
        if ((typeof requested_user == 'undefined') || (requested_user === null) || (requested_user === "")){
            const response = {
                result: 'fail',
                message: 'Client did not request a valid user to engage in play'
            };
            socket.emit('game_start_response', response);
            serverLog('game_start command failed', JSON.stringify(response));
            return;
        }

        if ((typeof room == 'undefined') || (room === null) || (room === "")){
            const response = {
                result: 'fail',
                message: 'The user that is engaged to play is not in a room'
            };
            socket.emit('game_start_response', response);
            serverLog('game_start command failed', JSON.stringify(response));
            return;
        }

        if ((typeof username == 'undefined') || (username === null) || (username == "")){
            const response = {
                result: 'fail',
                message: 'The user that was uninvited does not have a name registered'
            };
            socket.emit('game_start_response', response);
            serverLog('game_start command failed', JSON.stringify(response));
            return;
        }

        /* Make sure that the player to engage is present */
        io.in(room).allSockets().then((sockets) => {
            /* Engaged player isn't in the room */
            if ((typeof sockets == 'undefined') || (sockets === null) || !sockets.has(requested_user)){
                response = {
                    result: 'fail',
                    message: 'The user that was engaged to play is no longer in the room'
                };
                socket.emit('game_start_response', response);
                serverLog('game_start command failed', JSON.stringify(response));
                return;
            } 
            
            /* Engaged player is in the room */
            else {
                let game_id = Math.floor(1 + Math.random() * 0x100000).toString(16);
                response = {
                    result: 'success',
                    game_id: game_id,
                    socket_id: requested_user,
                };
                socket.emit("game_start_response", response);
                socket.to(requested_user).emit("game_start_response", response);
                serverLog('game_start command succeeded', JSON.stringify(response));
            }
        });
    });



    /* Handle disconnection */
    socket.on('disconnect', () => {
        serverLog('A page disconnected from the server: ' + socket.id);
        if ((typeof players[socket.id] != 'undefined') && (players[socket.id] != null)){
            const payload = {
                username: players[socket.id].username,
                room: players[socket.id].room,
                count: Object.keys(players).length - 1,
                socket_id: socket.id
            };
            const room = players[socket.id].room;
            delete players[socket.id];
            /* Tell everyone who left the room */
            io.of("/").to(room).emit('player_disconnected', payload);
            serverLog('player_disconnected succeeded', JSON.stringify(payload));
        }
    });

    /* Handle send_chat_message command */
    socket.on('send_chat_message', (payload) => {
        serverLog('Server received a command', '\'send_chat_message\'', JSON.stringify(payload));

        /* Check that the data is coming from the client is good */
        if ((typeof payload == 'undefined') || (payload === null)){
                response = {
                result: 'fail',
                message: 'Client did not send a payload'
            };
            socket.emit('send_chat_message_response', response);
            serverLog('send_chat_message command failed', JSON.stringify(response));
            return;
        }

        let room = payload.room;
        let username = payload.username;
        let message = payload.message;

        if ((typeof room == 'undefined') || (room === null)){
                response = {
                result: 'fail',
                message: 'Client did not send a valid room to message'
            };
            socket.emit('send_chat_message_response', response);
            serverLog('send_chat_message command failed', JSON.stringify(response));
            return;
        }

        if ((typeof username == 'undefined') || (username === null)){
                response = {
                result: 'fail',
                message: 'Client did not send a valid username to join the chat room'
            };
            socket.emit('send_chat_message_response', response);
            serverLog('send_chat_message command failed', JSON.stringify(response));
            return;
        }

        if ((typeof message == 'undefined') || (message === null)){
            response = {
                result: 'fail',
                message: 'Client did not send a valid message'
            };
            socket.emit('send_chat_message_response', response);
            serverLog('send_chat_message command failed', JSON.stringify(response));
            return;
        }

        /* Handle the command */
            response = {
            result: 'success',
            username: username,
            room: room,
            message: message
        };
        /* Tell everyone in the room what the message is */
        io.of('/').to(room).emit('send_chat_message_response', response);
        serverLog('send_chat_message command succeeded', JSON.stringify(response));
    });


    socket.on('play_token', (payload) => {
        serverLog('Server received a command', '\'play_token\'', JSON.stringify(payload));
    
        /* Check that the data coming from the client is valid */
        if (typeof payload === 'undefined' || payload === null) {
            const response = {
                result: 'fail',
                message: 'Client did not send a payload'
            };
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
    
        // Check if the player is registered
        let player = players[socket.id];
        if (!player) {
            const response = {
                result: 'fail',
                message: 'Play token came from an unregistered player'
            };
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
    
        let username = player.username;
        if (!username) {
            const response = {
                result: 'fail',
                message: 'play_token command did not come from a registered username'
            };
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
    
        let game_id = player.room;
        if (!game_id) {
            const response = {
                result: 'fail',
                message: 'There was no valid game associated with the play_token command'
            };
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
    
        let row = payload.row;
        if (typeof row === 'undefined' || row === null) {
            const response = {
                result: 'fail',
                message: 'There was no valid row associated with the play_token command'
            };
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
    
        let column = payload.column;
        if (typeof column === 'undefined' || column === null) {
            const response = {
                result: 'fail',
                message: 'There was no valid column associated with the play_token command'
            };
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
    
        let color = payload.color;
        if (typeof color === 'undefined' || color === null) {
            const response = {
                result: 'fail',
                message: 'There was no valid color associated with the play_token command'
            };
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
    
        let game = games[game_id];
        if (!game) {
            const response = {
                result: 'fail',
                message: 'There was no valid game associated with the play_token command'
            };
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
    
        // Emit success response first
        const successResponse = {
            result: 'success'
        };
        socket.emit('play_token_response', successResponse);
    
        /* Execute the move */
        if (color === 'white') {
            game.board[row][column] = 'w';
            game.whose_turn = 'black';
        } else if (color === 'black') {
            game.board[row][column] = 'b';
            game.whose_turn = 'white';
        }
    
        // Send game update to all clients
        send_game_update(socket, game_id, 'played a token');
    });
    
});




/******************************/
/* Code related to game state */

let games = [];

function create_new_game() {
    let new_game = {};
    new_game.player_white = {};
    new_game.player_white.socket = "";
    new_game.player_white.username = "";
    new_game.player_black = {};
    new_game.player_black.socket = "";
    new_game.player_black.username = "";

    var d = new Date();
    new_game.last_move_time = d.getTime();

    new_game.whose_turn = "white";

    new_game.board = [
        [' ',' ',' ',' ',' ',' ',' ',' '],
        [' ',' ',' ',' ',' ',' ',' ',' '],
        [' ',' ',' ',' ',' ',' ',' ',' '],
        [' ',' ',' ','w','b',' ',' ',' '],
        [' ',' ',' ','b','w',' ',' ',' '],
        [' ',' ',' ',' ',' ',' ',' ',' '],
        [' ',' ',' ',' ',' ',' ',' ',' '],
        [' ',' ',' ',' ',' ',' ',' ',' ']
    ];

    return new_game;

}

function send_game_update(socket, game_id, message) {

    /* Send game update */
    /* Check if the game is over */

    /* Check to see if a game with game_id exists */
    if ((typeof games[game_id] == 'undefined' || (games[game_id]) === null)) {
        console.log("No game exists with the game_id:" +game_id+ ". Making a new game for " +socket.id);
        games[game_id] = create_new_game();
    }

    /* Make sure that only 2 people are in the room */
   /* Assign this socket a color */
io.of('/').to(game_id).allSockets().then((sockets) => {
    const iterator = sockets[Symbol.iterator]();
    if (sockets.size >= 1) {
        let first = iterator.next().value;
        if ((games[game_id].player_white.socket != first) &&
            (games[game_id].player_black.socket != first)) {
            /* Player does not have a color */
            if (games[game_id].player_white.socket === "") {
                /* This player should be white */
                console.log("White is assigned to: " + first);
                games[game_id].player_white.socket = first;
                games[game_id].player_white.username = players[first].username;
            }
            else if (games[game_id].player_black.socket === "") {
                /* This player should be black */
                console.log("Black is assigned to: " + first);
                games[game_id].player_black.socket = first;
                games[game_id].player_black.username = players[first].username;
            }
            else {
                /* This player should be kicked out */
                console.log("Kicking " + first + " out of game: " + game_id);
                io.in(first).socketsLeave([game_id]);
            }
        }
    }

    if (sockets.size >= 2) {
        let second = iterator.next().value;  // Define 'second' properly
        if ((games[game_id].player_white.socket != second) &&
            (games[game_id].player_black.socket != second)) {
            /* Player does not have a color */
            if (games[game_id].player_white.socket === "") {
                /* This player should be white */
                console.log("White is assigned to: " + second);
                games[game_id].player_white.socket = second;
                games[game_id].player_white.username = players[second].username;
            }
            else if (games[game_id].player_black.socket === "") {
                /* This player should be black */
                console.log("Black is assigned to: " + second);
                games[game_id].player_black.socket = second;
                games[game_id].player_black.username = players[second].username;
            }
            else {
                /* This player should be kicked out */
                console.log("Kicking " + second + " out of game: " + game_id);
                io.in(second).socketsLeave([game_id]);
            }
        }
    }

    /* Send game update */
    let payload = {
        result: 'success',
        game_id: game_id,
        game: games[game_id],
        message: 'Game updated successfully'
    };
    io.of("/").to(game_id).emit('game_update', payload);
}).catch((err) => {
    console.error("Error retrieving sockets or processing game state: ", err);
});


    /* Check if game is over */
    let count = 0
    for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 8; column++) {
            if (games[game_id].board[row][column] !== ' ') {
                count++;
            }
        }
    }
    if (count === 64) {
        let payload = {
            result: 'success',
            game_id: game_id,
            game: games[game_id],
            won_who: 'everyone'
        }
        io.in(game_id).emit('game_over', payload);

        /* Delete old games after one hour */
        setTimeout(
            ((id) => {
                return (() => {
                    delete games[id];
                });
            })(game_id), 60 * 60 * 1000
        );
    }
}


