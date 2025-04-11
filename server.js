const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// MongoDB Connection
const uri = 'mongodb://localhost:27017'; // Default local MongoDB URI
const dbName = 'chatdb';
let db;

async function connectToMongo() {
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db(dbName);
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}

connectToMongo();

// Track connected users
const clients = new Map();
const users = new Set();

wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', async (message) => {
    console.log('Raw message received:', message);
    let data;
    try {
      data = JSON.parse(message);
      console.log('Parsed data:', data);
    } catch (e) {
      console.error('Failed to parse message:', e);
      return;
    }

    switch (data.type) {
      case 'login':
        const username = data.username.trim();
        console.log('Login attempt for username:', username);
        if (users.has(username)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Username already taken' }));
        } else {
          users.add(username);
          clients.set(ws, username);
          ws.send(JSON.stringify({ type: 'login', success: true }));
          broadcastUserList();
        }
        break;

      case 'joinRoom':
        const room = data.room.trim();
        if (!db) {
          ws.send(JSON.stringify({ type: 'error', message: 'Database not connected' }));
          return;
        }
        ws.send(JSON.stringify({ type: 'joinedRoom', room }));
        const messages = await db.collection('messages').find({ room }).toArray();
        ws.send(JSON.stringify({ type: 'history', room, messages }));
        break;

      case 'message':
        const from = clients.get(ws);
        const text = data.text || '';
        const file = data.file || null;
        const msg = { username: from, text, file, room: data.room, timestamp: new Date().toISOString() };

        if (data.to) {
          // Private message
          const targetWs = Array.from(clients.entries()).find(([_, name]) => name === data.to)?.[0];
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({ type: 'message', from, to: data.to, text, file, timestamp: msg.timestamp }));
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'message', from: data.to, to: from, text, file, timestamp: msg.timestamp }));
            }
          }
        } else if (data.room) {
          // Room message
          if (db) {
            await db.collection('messages').insertOne(msg); // Store in MongoDB
          }
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'message', room: data.room, ...msg }));
            }
          });
        }
        break;

      case 'status':
        broadcastUserList();
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    const username = clients.get(ws);
    if (username) {
      users.delete(username);
      clients.delete(ws);
      broadcastUserList();
    }
  });

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  }});


function broadcastUserList() {
  const userList = Array.from(users).map(name => {
    let isOnline = false;
    for (const ws of wss.clients) {
      if (clients.get(ws) === name && ws.readyState === WebSocket.OPEN) {
        isOnline = true;
        break;
      }
    }
    return { name, status: isOnline ? 'online' : 'offline' };
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'userList', users: userList }));
    }
  });
  console.log('Broadcasting user list to clients');
}

server.listen(3000, 'localhost', () => { // Changed to 'localhost'
  console.log('Server running on http://localhost:3000');
});

// Ensure MongoDB connection is closed when server stops
process.on('SIGINT', async () => {
  if (db) {
    await db.client.close();
    console.log('MongoDB connection closed');
  }
  process.exit();
});