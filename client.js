let ws = null;
let username = null;
let isLoggedIn = false;
let joinedRooms = new Set();

function login() {
  const input = document.getElementById('username').value.trim();
  if (!input || isLoggedIn) {
    alert('Please enter a username or you are already logged in!');
    return;
  }

  console.log('Attempting to login with username:', input);
  username = input;

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close();
    console.log('Closing existing WebSocket connection');
  }

  ws = new WebSocket('ws://localhost:3000'); // Reverted to localhost

  ws.onopen = () => {
    console.log('WebSocket connection opened');
    ws.send(JSON.stringify({ type: 'login', username }));
  };

  ws.onmessage = (event) => {
    console.log('Received raw message:', event.data);
    let data;
    try {
      data = JSON.parse(event.data);
      console.log('Parsed message data:', data);
    } catch (e) {
      console.error('Failed to parse message:', e);
      return;
    }

    switch (data.type) {
      case 'login':
        if (data.success) {
          isLoggedIn = true;
          addMessage(`Welcome, ${username}!`);
          const loginDiv = document.getElementById('login');
          const chatDiv = document.getElementById('chat');
          if (loginDiv && chatDiv) {
            loginDiv.style.display = 'none';
            chatDiv.style.display = 'flex';
          }
          requestNotificationPermission();
        } else {
          alert(data.message);
        }
        break;
      case 'error':
        alert(data.message);
        break;
      case 'userList':
        updateUserList(data.users);
        break;
      case 'joinedRoom':
        if (!joinedRooms.has(data.room)) {
          joinedRooms.add(data.room);
          addMessage(`Successfully joined room: ${data.room}`);
        }
        break;
      case 'history':
        data.messages.forEach(msg => displayMessage(msg, data.room));
        break;
      case 'message':
        displayMessage(data, data.room);
        if (document.hidden) showNotification(data);
        break;
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed');
    isLoggedIn = false;
    joinedRooms.clear();
    setTimeout(() => {
      if (!isLoggedIn) login();
    }, 1000);
  };

  let visibilityTimeout;
  document.addEventListener('visibilitychange', () => {
    if (ws && ws.readyState === WebSocket.OPEN && username) {
      clearTimeout(visibilityTimeout);
      visibilityTimeout = setTimeout(() => {
        ws.send(JSON.stringify({ type: 'status', status: document.hidden ? 'offline' : 'online' }));
      }, 500);
    }
  }, { once: false });
}

function logout() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (confirm('Are you sure you want to logout?')) {
      ws.close();
    } else {
      return;
    }
  }
  isLoggedIn = false;
  joinedRooms.clear();
  username = null;
  const loginDiv = document.getElementById('login');
  const chatDiv = document.getElementById('chat');
  if (loginDiv && chatDiv) {
    loginDiv.style.display = 'block';
    chatDiv.style.display = 'none';
    document.getElementById('username').value = '';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('users').innerHTML = '';
    document.getElementById('room').value = '';
    document.getElementById('to').value = '';
  }
  console.log('Logged out');
}

function joinRoom() {
  const room = document.getElementById('room').value.trim();
  if (room && ws && ws.readyState === WebSocket.OPEN && !joinedRooms.has(room)) {
    joinedRooms.add(room);
    ws.send(JSON.stringify({ type: 'joinRoom', room }));
  } else if (joinedRooms.has(room)) {
    alert(`You are already in room: ${room}`);
  }
}

function sendMessage() {
  const text = document.getElementById('message').value.trim();
  const room = document.getElementById('room').value.trim();
  const to = document.getElementById('to').value.trim();
  const fileInput = document.getElementById('file');
  let fileData = null;

  if (!text && !fileInput.files[0]) {
    alert('Please enter a message or select a file!');
    return;
  }

  if (fileInput.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      fileData = reader.result.split(',')[1];
      sendMessagePayload({ text, room, to, file: fileData });
      fileInput.value = '';
    };
    reader.readAsDataURL(fileInput.files[0]);
  } else {
    sendMessagePayload({ text, room, to, file: null });
  }
}

function sendMessagePayload({ text, room, to, file }) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (to) {
      ws.send(JSON.stringify({ type: 'message', from: username, to, text, file }));
    } else if (room) {
      ws.send(JSON.stringify({ type: 'message', room, text, file }));
    }
    document.getElementById('message').value = '';
  }
}

function displayMessage(data, room) {
  let msg = '';
  if (room) msg += `[${room}] `;
  if (data.from) msg += `[Private] ${data.from}: `;
  else if (data.to) msg += `[To ${data.to}]: `;
  else msg += `${data.username}: `;
  if (data.text) msg += data.text;
  if (data.file) {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${data.file}`;
    img.onload = () => {
      addMessage(`${msg}<br><img src="${img.src}" class="chat-image"> <span class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</span>`);
    };
    img.onerror = () => {
      addMessage(`${msg}<br>[Image failed to load] <span class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</span>`);
    };
  } else {
    addMessage(`${msg} <span class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</span>`);
  }
}

function addMessage(msg) {
  const messages = document.getElementById('messages');
  messages.innerHTML += `<p>${msg}</p>`;
  messages.scrollTop = messages.scrollHeight;
}

function updateUserList(users) {
  const userDiv = document.getElementById('users');
  userDiv.innerHTML = 'Users: ';
  users.forEach(user => {
    userDiv.innerHTML += `<span class="${user.status}" title="${user.name} is ${user.status}">${user.name}</span> `;
  });
}

function requestNotificationPermission() {
  if (Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
}

function showNotification(data) {
  if (Notification.permission === 'granted') {
    new Notification('New Message', {
      body: `${data.from || data.username}: ${data.text || 'Sent an image'}`,
    });
  }
}