import {
  database,
  auth,
  ref,
  set,
  get,
  update,
  push,
  onValue,
  onDisconnect,
  remove,
  serverTimestamp,
  signInAnonymously
} from "./firebase-config.js";

const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY";

const state = {
  user: null,
  roomCode: null,
  room: null,
  player: null,
  roomUnsubscribe: null,
  playerReady: false,
  applyingRemoteState: false,
  syncTimer: null,
  deferredInstall: null,
  lastActionAt: 0
};

const $ = id => document.getElementById(id);

function toast(text) {
  const element = $("toast");
  element.textContent = text;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2400);
}

function error(text) {
  $("welcomeError").textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
}

function name() {
  return (
    $("nameInput").value.trim().slice(0, 24) ||
    localStorage.getItem("syncroom-name") ||
    "Guest"
  );
}

function saveName(value) {
  localStorage.setItem("syncroom-name", value);
}

function roomRef() {
  return ref(database, `rooms/${state.roomCode}`);
}

function membersRef() {
  return ref(database, `rooms/${state.roomCode}/members`);
}

function queueRef() {
  return ref(database, `rooms/${state.roomCode}/queue`);
}

function chatRef() {
  return ref(database, `rooms/${state.roomCode}/chat`);
}

function isHost() {
  return Boolean(state.room && state.room.hostId === state.user?.uid);
}

function getPosition() {
  if (
    state.player &&
    state.playerReady &&
    typeof state.player.getCurrentTime === "function"
  ) {
    return Number(state.player.getCurrentTime() || 0);
  }

  return Number(state.room?.state?.position || 0);
}

function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const remaining = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}

async function signIn() {
  if (auth.currentUser) {
    state.user = auth.currentUser;
    return;
  }

  const result = await signInAnonymously(auth);
  state.user = result.user;
}

function setConnection(connected) {
  const element = $("connectionStatus");
  element.textContent = connected ? "Connected" : "Offline";
  element.className = `status ${connected ? "online" : "offline"}`;
}

async function createRoom() {
  try {
    await signIn();

    const roomCode = code();
    const displayName = name();
    saveName(displayName);

    state.roomCode = roomCode;

    await set(roomRef(), {
      code: roomCode,
      hostId: state.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      state: {
        videoId: "",
        title: "",
        channel: "",
        playing: false,
        position: 0,
        updatedAt: Date.now()
      },
      queue: {},
      members: {
        [state.user.uid]: {
          name: displayName,
          color: randomColor(),
          joinedAt: serverTimestamp(),
          online: true
        }
      },
      chat: {},
      activity: {}
    });

    await openRoom();
  } catch (err) {
    error(err.message || "Could not create room.");
  }
}

async function joinRoom() {
  try {
    await signIn();

    const roomCode = $("roomInput").value.trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
      error("Enter a six-character room code.");
      return;
    }

    state.roomCode = roomCode;

    const snapshot = await get(roomRef());

    if (!snapshot.exists()) {
      error("Room not found.");
      return;
    }

    const currentRoom = snapshot.val();

    if (currentRoom.locked) {
      error("This room is locked.");
      return;
    }

    await update(
      ref(database, `rooms/${roomCode}/members/${state.user.uid}`),
      {
        name: name(),
        color: randomColor(),
        joinedAt: serverTimestamp(),
        online: true
      }
    );

    await addActivity(`${name()} joined the room`);
    await openRoom();
  } catch (err) {
    error(err.message || "Could not join room.");
  }
}

async function openRoom() {
  $("welcomeView").classList.add("hidden");
  $("roomView").classList.remove("hidden");
  $("roomCodeText").textContent = state.roomCode;
  saveName(name());
  setConnection(true);

  const memberRef = ref(
    database,
    `rooms/${state.roomCode}/members/${state.user.uid}`
  );

  onDisconnect(memberRef).update({
    online: false,
    lastSeen: serverTimestamp()
  });

  state.roomUnsubscribe = onValue(roomRef(), snapshot => {
    if (!snapshot.exists()) {
      leaveRoom(false);
      return;
    }

    state.room = snapshot.val();
    renderAll();
    applyRemotePlayback();
  });

  state.syncTimer = setInterval(correctDrift, 3500);
}

async function leaveRoom(showWelcome = true) {
  if (state.syncTimer) clearInterval(state.syncTimer);
  if (state.roomUnsubscribe) state.roomUnsubscribe();

  if (state.roomCode && state.user) {
    try {
      await update(
        ref(database, `rooms/${state.roomCode}/members/${state.user.uid}`),
        {
          online: false,
          lastSeen: serverTimestamp()
        }
      );
    } catch {}
  }

  state.room = null;
  state.roomCode = null;
  state.roomUnsubscribe = null;

  if (showWelcome) {
    $("roomView").classList.add("hidden");
    $("welcomeView").classList.remove("hidden");
    setConnection(false);
  }
}

function renderAll() {
  renderRoomHeader();
  renderQueue();
  renderMembers();
  renderChat();
  renderActivity();
  renderPlaybackText();
}

function renderRoomHeader() {
  const members = Object.values(state.room.members || {});
  $("memberCount").textContent = members.length;
  $("hostNotice").textContent = isHost()
    ? "You are the host. Your playback controls update the room."
    : "Only the host controls room playback.";
}

function renderPlaybackText() {
  const current = state.room.state || {};
  $("nowPlayingTitle").textContent = current.title || "Nothing playing";
  $("nowPlayingChannel").textContent =
    current.channel || "Choose a video from Search";
  $("playPauseButton").textContent = current.playing ? "Pause" : "Play";
}

function renderQueue() {
  const queue = Object.entries(state.room.queue || {});

  if (!queue.length) {
    $("queueList").innerHTML =
      `<p class="muted">Queue is empty. Search for a video to add one.</p>`;
    return;
  }

  $("queueList").innerHTML = queue.map(([id, item], index) => `
    <div class="queueItem">
      <img class="queueThumb" src="${escapeHtml(item.thumbnail)}" alt="">
      <div class="queueInfo">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.channel || "")}</small>
        <small>Added by ${escapeHtml(item.addedByName || "Guest")}</small>
      </div>
      <button class="secondary" data-play-queue="${id}">Play</button>
      <button class="danger" data-remove-queue="${id}">×</button>
    </div>
  `).join("");

  document.querySelectorAll("[data-play-queue]").forEach(button => {
    button.onclick = () => playQueueItem(button.dataset.playQueue);
  });

  document.querySelectorAll("[data-remove-queue]").forEach(button => {
    button.onclick = () => removeQueueItem(button.dataset.removeQueue);
  });
}

function renderMembers() {
  const entries = Object.entries(state.room.members || {});

  $("membersList").innerHTML = entries.map(([id, member]) => `
    <div class="memberItem">
      <div
        class="chatAvatar"
        style="background:${escapeHtml(member.color || "#4f46e5")}"
      >
        ${escapeHtml((member.name || "G").charAt(0).toUpperCase())}
      </div>
      <div class="memberInfo">
        <strong>${escapeHtml(member.name || "Guest")}</strong>
        <small>
          ${id === state.room.hostId ? "Host · " : ""}
          ${member.online ? "Online" : "Offline"}
        </small>
      </div>
      ${
        isHost() && id !== state.user.uid
          ? `<button class="danger" data-kick="${id}">Remove</button>`
          : ""
      }
    </div>
  `).join("");

  document.querySelectorAll("[data-kick]").forEach(button => {
    button.onclick = () => removeMember(button.dataset.kick);
  });
}

function renderChat() {
  const messages = Object.values(state.room.chat || {})
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

  $("chatMessages").innerHTML = messages.map(item => `
    <div class="chatMessage">
      <div
        class="chatAvatar"
        style="background:${escapeHtml(item.color || "#4f46e5")}"
      >
        ${escapeHtml((item.name || "G").charAt(0).toUpperCase())}
      </div>
      <div class="chatContent">
        <strong>${escapeHtml(item.name || "Guest")}</strong>
        <small class="muted">${formatTimeAgo(item.createdAt)}</small>
        <p>${escapeHtml(item.text)}</p>
      </div>
    </div>
  `).join("") || `<p class="muted">No messages yet.</p>`;

  const box = $("chatMessages");
  box.scrollTop = box.scrollHeight;
}

function renderActivity() {
  const entries = Object.values(state.room.activity || {})
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 30);

  $("activityList").innerHTML = entries.map(item => `
    <div class="activityItem">
      <span>•</span>
      <div>
        <div>${escapeHtml(item.text)}</div>
        <small>${formatTimeAgo(item.createdAt)}</small>
      </div>
    </div>
  `).join("") || `<p class="muted">Room activity will appear here.</p>`;
}

function formatTimeAgo(value) {
  if (!value) return "now";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));

  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function randomColor() {
  const colors = [
    "#4f46e5",
    "#0891b2",
    "#16a34a",
    "#db2777",
    "#ea580c",
    "#7c3aed"
  ];

  return colors[Math.floor(Math.random() * colors.length)];
}

async function addActivity(text) {
  if (!state.roomCode) return;

  const itemRef = push(ref(database, `rooms/${state.roomCode}/activity`));

  await set(itemRef, {
    text,
    createdAt: Date.now()
  });
}

async function searchYouTube() {
  const query = $("searchInput").value.trim();

  if (!query) {
    $("searchStatus").textContent = "Type something to search.";
    return;
  }

  if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === "AIzaSyDzvPXVkAkiW6xMzo6zV671pMNRF_1M200") {
    $("searchStatus").textContent =
      "Add your YouTube API key in app.js first.";
    return;
  }

  $("searchStatus").textContent = "Searching...";
  $("searchResults").innerHTML = "";

  const url = new URL("https://www.googleapis.com/youtube/v3/search");

  url.search = new URLSearchParams({
    key: YOUTUBE_API_KEY,
    part: "snippet",
    q: query,
    type: "video",
    maxResults: "10",
    videoEmbeddable: "true",
    safeSearch: "moderate"
  });

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "YouTube search failed.");
    }

    $("searchStatus").textContent =
      `${data.items?.length || 0} results found`;

    $("searchResults").innerHTML = (data.items || []).map(item => {
      const videoId = item.id.videoId;
      const snippet = item.snippet;

      return `
        <div class="searchItem">
          <img
            class="searchThumb"
            src="${escapeHtml(snippet.thumbnails.medium.url)}"
            alt=""
          >
          <div class="searchInfo">
            <strong>${escapeHtml(snippet.title)}</strong>
            <small>${escapeHtml(snippet.channelTitle)}</small>
            <p class="muted">${escapeHtml(snippet.description || "")}</p>
            <button
              data-add-video="${escapeHtml(videoId)}"
              data-video-title="${escapeHtml(snippet.title)}"
              data-video-channel="${escapeHtml(snippet.channelTitle)}"
              data-video-thumb="${escapeHtml(snippet.thumbnails.medium.url)}"
            >
              Add to queue
            </button>
          </div>
        </div>
      `;
    }).join("");

    document.querySelectorAll("[data-add-video]").forEach(button => {
      button.onclick = () => addToQueue({
        videoId: button.dataset.addVideo,
        title: button.dataset.videoTitle,
        channel: button.dataset.videoChannel,
        thumbnail: button.dataset.videoThumb
      });
    });
  } catch (err) {
    $("searchStatus").textContent = err.message;
  }
}

async function addToQueue(item) {
  if (!state.roomCode) return;

  const itemRef = push(queueRef());

  await set(itemRef, {
    ...item,
    addedBy: state.user.uid,
    addedByName: currentMember()?.name || name(),
    addedAt: Date.now(),
    votes: {}
  });

  if (!state.room.state?.videoId) {
    await update(ref(database, `rooms/${state.roomCode}/state`), {
      videoId: item.videoId,
      title: item.title,
      channel: item.channel,
      playing: false,
      position: 0,
      updatedAt: Date.now()
    });

    await remove(itemRef);
  }

  await addActivity(`${name()} added “${item.title}”`);
  toast("Added to queue");
}

function currentMember() {
  return state.room?.members?.[state.user?.uid];
}

async function removeQueueItem(id) {
  if (!isHost()) {
    toast("Only the host can remove queue items.");
    return;
  }

  await remove(ref(database, `rooms/${state.roomCode}/queue/${id}`));
}

async function playQueueItem(id) {
  if (!isHost()) {
    toast("Only the host can play queue items.");
    return;
  }

  const item = state.room.queue?.[id];

  if (!item) return;

  await update(ref(database, `rooms/${state.roomCode}/state`), {
    videoId: item.videoId,
    title: item.title,
    channel: item.channel,
    playing: true,
    position: 0,
    updatedAt: Date.now()
  });

  await remove(ref(database, `rooms/${state.roomCode}/queue/${id}`));
}

async function playNext() {
  if (!isHost()) {
    toast("Only the host can control playback.");
    return;
  }

  const entries = Object.entries(state.room.queue || {});

  if (!entries.length) {
    await update(ref(database, `rooms/${state.roomCode}/state`), {
      videoId: "",
      title: "",
      channel: "",
      playing: false,
      position: 0,
      updatedAt: Date.now()
    });
    return;
  }

  const [id, item] = entries[0];

  await update(ref(database, `rooms/${state.roomCode}/state`), {
    videoId: item.videoId,
    title: item.title,
    channel: item.channel,
    playing: true,
    position: 0,
    updatedAt: Date.now()
  });

  await remove(ref(database, `rooms/${state.roomCode}/queue/${id}`));
}

async function playPrevious() {
  if (!isHost()) return;

  await update(ref(database, `rooms/${state.roomCode}/state`), {
    position: 0,
    playing: false,
    updatedAt: Date.now()
  });

  setTimeout(() => {
    update(ref(database, `rooms/${state.roomCode}/state`), {
      playing: true,
      updatedAt: Date.now()
    });
  }, 300);
}

async function togglePlay() {
  if (!isHost()) {
    toast("Only the host can control playback.");
    return;
  }

  await update(ref(database, `rooms/${state.roomCode}/state`), {
    playing: !state.room.state.playing,
    position: getPosition(),
    updatedAt: Date.now()
  });
}

async function seekFromSlider() {
  if (!isHost() || !state.playerReady) return;

  const duration = state.player.getDuration();
  const position = duration * Number($("seekBar").value) / 100;

  state.player.seekTo(position, true);

  await update(ref(database, `rooms/${state.roomCode}/state`), {
    position,
    playing: state.room.state.playing,
    updatedAt: Date.now()
  });
}

async function shuffleQueue() {
  if (!isHost()) return;

  const entries = Object.entries(state.room.queue || {});
  entries.sort(() => Math.random() - 0.5);

  const shuffled = {};

  entries.forEach(([id, item]) => {
    shuffled[id] = item;
  });

  await set(queueRef(), shuffled);
  await addActivity(`${name()} shuffled the queue`);
}

async function clearQueue() {
  if (!isHost()) return;

  await remove(queueRef());
  await addActivity(`${name()} cleared the queue`);
}

async function sendChat(event) {
  event.preventDefault();

  const input = $("chatInput");
  const text = input.value.trim().slice(0, 300);

  if (!text) return;

  const itemRef = push(chatRef());

  await set(itemRef, {
    uid: state.user.uid,
    name: currentMember()?.name || name(),
    color: currentMember()?.color || "#4f46e5",
    text,
    createdAt: Date.now()
  });

  input.value = "";
}

async function removeMember(uid) {
  if (!isHost() || uid === state.user.uid) return;

  await remove(ref(database, `rooms/${state.roomCode}/members/${uid}`));
  await addActivity(`${name()} removed a member`);
}

function applyRemotePlayback() {
  if (!state.room?.state || !state.playerReady) return;

  const current = state.room.state;
  const targetPosition =
    Number(current.position || 0) +
    Math.max(0, (Date.now() - Number(current.updatedAt || Date.now())) / 1000);

  const currentVideo =
    state.player.getVideoData?.().video_id || "";

  state.applyingRemoteState = true;

  if (currentVideo !== current.videoId) {
    if (current.videoId) {
      state.player.loadVideoById({
        videoId: current.videoId,
        startSeconds: targetPosition
      });
    }
  } else {
    const difference =
      Math.abs(state.player.getCurrentTime() - targetPosition);

    if (difference > 0.45) {
      state.player.seekTo(targetPosition, true);
    }

    if (current.playing) {
      state.player.playVideo();
    } else {
      state.player.pauseVideo();
    }
  }

  $("syncIndicator").textContent = "Synced";

  setTimeout(() => {
    state.applyingRemoteState = false;
  }, 600);
}

function correctDrift() {
  if (!state.room?.state || !state.playerReady) return;

  const current = state.room.state;

  if (!current.videoId) return;

  const expected =
    Number(current.position || 0) +
    Math.max(0, (Date.now() - Number(current.updatedAt || Date.now())) / 1000);

  const actual = state.player.getCurrentTime();
  const difference = Math.abs(actual - expected);

  $("syncIndicator").textContent =
    difference > 0.7 ? `Behind ${difference.toFixed(1)}s` : "Synced";

  if (difference > 0.7) {
    state.applyingRemoteState = true;
    state.player.seekTo(expected, true);

    if (current.playing) state.player.playVideo();
    else state.player.pauseVideo();

    setTimeout(() => {
      state.applyingRemoteState = false;
    }, 300);
  }
}

function onYouTubeIframeAPIReady() {
  state.player = new YT.Player("player", {
    width: "100%",
    height: "100%",
    videoId: "",
    playerVars: {
      controls: 1,
      playsinline: 1,
      rel: 0
    },
    events: {
      onReady: () => {
        state.playerReady = true;
        $("playerLoading").classList.add("hidden");
        applyRemotePlayback();
      },
      onStateChange: event => {
        if (state.applyingRemoteState || !isHost()) return;

        if (event.data === YT.PlayerState.PLAYING) {
          updatePlayback(true);
        }

        if (event.data === YT.PlayerState.PAUSED) {
          updatePlayback(false);
        }

        if (event.data === YT.PlayerState.ENDED) {
          playNext();
        }
      },
      onError: () => {
        toast("This YouTube video cannot be embedded.");
      }
    }
  });
}

async function updatePlayback(playing) {
  if (!isHost()) return;

  await update(ref(database, `rooms/${state.roomCode}/state`), {
    playing,
    position: getPosition(),
    updatedAt: Date.now()
  });
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach(item =>
        item.classList.remove("active")
      );

      document.querySelectorAll(".tabPanel").forEach(panel =>
        panel.classList.add("hidden")
      );

      tab.classList.add("active");
      $(tab.dataset.tab).classList.remove("hidden");
    };
  });
}

function setupSettings() {
  $("darkThemeToggle").onchange = event => {
    document.documentElement.classList.toggle(
      "light",
      !event.target.checked
    );
  };

  $("largeControlsToggle").onchange = event => {
    document.body.classList.toggle(
      "largeControls",
      event.target.checked
    );
  };

  $("saveProfileButton").onclick = async () => {
    const displayName = name();
    saveName(displayName);

    if (state.roomCode && state.user) {
      await update(
        ref(database, `rooms/${state.roomCode}/members/${state.user.uid}`),
        { name: displayName }
      );
    }

    toast("Profile saved");
  };
}

function setupPwa() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredInstall = event;
    $("installButton").classList.remove("hidden");
  });

  $("installButton").onclick = async () => {
    if (!state.deferredInstall) return;

    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    $("installButton").classList.add("hidden");
  };
}

$("createRoomButton").onclick = createRoom;

$("showJoinButton").onclick = () => {
  $("joinBox").classList.toggle("hidden");
};

$("joinRoomButton").onclick = joinRoom;
$("leaveRoomButton").onclick = () => leaveRoom(true);

$("copyRoomButton").onclick = async () => {
  await navigator.clipboard.writeText(state.roomCode);
  toast("Room code copied");
};

$("shareRoomButton").onclick = async () => {
  const shareData = {
    title: "Join my SyncRoom",
    text: `Join my YouTube room: ${state.roomCode}`,
    url: `${location.origin}${location.pathname}?room=${state.roomCode}`
  };

  if (navigator.share) {
    await navigator.share(shareData);
  } else {
    await navigator.clipboard.writeText(shareData.url);
    toast("Room link copied");
  }
};

$("searchButton").onclick = searchYouTube;

$("searchInput").addEventListener("keydown", event => {
  if (event.key === "Enter") searchYouTube();
});

$("playPauseButton").onclick = togglePlay;
$("nextButton").onclick = playNext;
$("previousButton").onclick = playPrevious;
$("syncNowButton").onclick = applyRemotePlayback;
$("shuffleButton").onclick = shuffleQueue;
$("clearQueueButton").onclick = clearQueue;
$("seekBar").onchange = seekFromSlider;
$("chatForm").onsubmit = sendChat;

setInterval(() => {
  if (!state.playerReady || !state.player?.getDuration) return;

  const duration = state.player.getDuration();
  const current = state.player.getCurrentTime();

  if (duration > 0) {
    $("seekBar").value = current / duration * 100;
    $("currentTimeText").textContent = formatTime(current);
    $("durationText").textContent = formatTime(duration);
  }
}, 1000);

window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

$("nameInput").value = localStorage.getItem("syncroom-name") || "";
setupTabs();
setupSettings();
setupPwa();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

const urlRoom = new URLSearchParams(location.search).get("room");

if (urlRoom) {
  $("roomInput").value = urlRoom.toUpperCase();
  $("joinBox").classList.remove("hidden");
}
