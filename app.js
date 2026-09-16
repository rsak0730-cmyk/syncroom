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

const YOUTUBE_API_KEY = "AIzaSyDzvPXVkAkiW6xMzo6zV671pMNRF_1M200'";

const state = {
  user: null,
  roomCode: null,
  room: null,
  player: null,
  playerReady: false,
  roomUnsubscribe: null,
  syncTimer: null,
  progressTimer: null,
  deferredInstall: null,
  applyingRemoteState: false
};

const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getName() {
  const inputName = $("nameInput")?.value.trim();

  return (
    inputName ||
    localStorage.getItem("syncroom-name") ||
    "Guest"
  ).slice(0, 24);
}

function saveName(value) {
  localStorage.setItem("syncroom-name", value);
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
}

function randomColor() {
  const colors = [
    "#4f46e5",
    "#0891b2",
    "#16a34a",
    "#ca8a04",
    "#db2777",
    "#9333ea",
    "#ea580c"
  ];

  return colors[Math.floor(Math.random() * colors.length)];
}

function showError(message) {
  if ($("welcomeError")) {
    $("welcomeError").textContent = message || "";
  }
}

function showToast(message) {
  const element = $("toast");

  if (!element) return;

  element.textContent = message;
  element.classList.add("show");

  setTimeout(() => {
    element.classList.remove("show");
  }, 2500);
}

function setConnection(connected) {
  const element = $("connectionStatus");

  if (!element) return;

  element.textContent = connected ? "Connected" : "Offline";
  element.className = `status ${connected ? "online" : "offline"}`;
}

function roomReference() {
  return ref(database, `rooms/${state.roomCode}`);
}

function membersReference() {
  return ref(database, `rooms/${state.roomCode}/members`);
}

function queueReference() {
  return ref(database, `rooms/${state.roomCode}/queue`);
}

function chatReference() {
  return ref(database, `rooms/${state.roomCode}/chat`);
}

function activityReference() {
  return ref(database, `rooms/${state.roomCode}/activity`);
}

function isHost() {
  return Boolean(
    state.user &&
    state.room &&
    state.room.hostId === state.user.uid
  );
}

function getCurrentPosition() {
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
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const remaining = String(value % 60).padStart(2, "0");

  return `${minutes}:${remaining}`;
}

function timeAgo(timestamp) {
  if (!timestamp) return "now";

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Number(timestamp)) / 1000)
  );

  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;

  return `${Math.floor(seconds / 3600)}h ago`;
}

async function signIn() {
  if (auth.currentUser) {
    state.user = auth.currentUser;
    setConnection(true);
    return state.user;
  }

  try {
    const result = await signInAnonymously(auth);

    state.user = result.user;
    setConnection(true);

    console.log("Anonymous Firebase login successful:", state.user.uid);

    return state.user;
  } catch (error) {
    setConnection(false);
    console.error("Firebase authentication error:", error);

    if (error.code === "auth/invalid-api-key") {
      throw new Error(
        "Firebase API key is invalid. Check firebase-config.js."
      );
    }

    if (error.code === "auth/operation-not-allowed") {
      throw new Error(
        "Anonymous Authentication is not enabled in Firebase Console."
      );
    }

    throw new Error(
      error.message || "Firebase authentication failed."
    );
  }
}

async function createRoom() {
  try {
    showError("");

    await signIn();

    const displayName = getName();
    const roomCode = createRoomCode();

    saveName(displayName);
    state.roomCode = roomCode;

    const initialRoom = {
      code: roomCode,
      hostId: state.user.uid,
      createdAt: Date.now(),
      updatedAt: Date.now(),

      state: {
        videoId: "",
        title: "",
        channel: "",
        thumbnail: "",
        playing: false,
        position: 0,
        updatedAt: Date.now()
      },

      members: {
        [state.user.uid]: {
          name: displayName,
          color: randomColor(),
          joinedAt: Date.now(),
          online: true
        }
      },

      queue: {},
      chat: {},
      activity: {}
    };

    await set(roomReference(), initialRoom);
    await addActivity(`${displayName} created the room`);

    await openRoom();
  } catch (error) {
    console.error("Create room error:", error);
    showError(error.message || "Could not create room.");
    setConnection(false);
  }
}

async function joinRoom() {
  try {
    showError("");

    await signIn();

    const input = $("roomInput");
    const roomCode = input?.value.trim().toUpperCase();

    if (!roomCode || !/^[A-Z0-9]{6}$/.test(roomCode)) {
      showError("Enter a valid six-character room code.");
      return;
    }

    state.roomCode = roomCode;

    const snapshot = await get(roomReference());

    if (!snapshot.exists()) {
      state.roomCode = null;
      showError("Room not found.");
      return;
    }

    const room = snapshot.val();

    if (room.locked === true) {
      state.roomCode = null;
      showError("This room is locked.");
      return;
    }

    const displayName = getName();
    saveName(displayName);

    await update(
      ref(database, `rooms/${roomCode}/members/${state.user.uid}`),
      {
        name: displayName,
        color: randomColor(),
        joinedAt: Date.now(),
        online: true
      }
    );

    await addActivity(`${displayName} joined the room`);
    await openRoom();
  } catch (error) {
    console.error("Join room error:", error);
    showError(error.message || "Could not join room.");
    setConnection(false);
  }
}

async function openRoom() {
  $("welcomeView")?.classList.add("hidden");
  $("roomView")?.classList.remove("hidden");

  if ($("roomCodeText")) {
    $("roomCodeText").textContent = state.roomCode;
  }

  const memberReference = ref(
    database,
    `rooms/${state.roomCode}/members/${state.user.uid}`
  );

  await update(memberReference, {
    online: true
  });

  onDisconnect(memberReference).update({
    online: false,
    lastSeen: serverTimestamp()
  });

  if (state.roomUnsubscribe) {
    state.roomUnsubscribe();
  }

  state.roomUnsubscribe = onValue(
    roomReference(),
    snapshot => {
      if (!snapshot.exists()) {
        showToast("This room no longer exists.");
        leaveRoom();
        return;
      }

      state.room = snapshot.val();

      setConnection(true);
      renderAll();
      applyRemotePlayback();
    },
    error => {
      console.error("Room listener error:", error);
      setConnection(false);
    }
  );

  clearInterval(state.syncTimer);
  state.syncTimer = setInterval(correctPlaybackDrift, 4000);

  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(updateProgressBar, 1000);

  renderAll();
}

async function leaveRoom() {
  try {
    if (state.roomCode && state.user) {
      await update(
        ref(database, `rooms/${state.roomCode}/members/${state.user.uid}`),
        {
          online: false,
          lastSeen: serverTimestamp()
        }
      );
    }
  } catch (error) {
    console.warn("Could not update offline status:", error);
  }

  clearInterval(state.syncTimer);
  clearInterval(state.progressTimer);

  if (state.roomUnsubscribe) {
    state.roomUnsubscribe();
  }

  state.room = null;
  state.roomCode = null;
  state.roomUnsubscribe = null;

  $("roomView")?.classList.add("hidden");
  $("welcomeView")?.classList.remove("hidden");

  setConnection(false);
}

async function updateRoomState(changes) {
  if (!state.roomCode || !state.room || !isHost()) {
    showToast("Only the host can control playback.");
    return;
  }

  const currentState = state.room.state || {};

  await update(ref(database, `rooms/${state.roomCode}/state`), {
    ...currentState,
    ...changes,
    updatedAt: Date.now()
  });
}

async function selectVideo(video) {
  if (!isHost()) {
    showToast("Only the host can start a video.");
    return;
  }

  const nextState = {
    videoId: video.videoId,
    title: video.title,
    channel: video.channel,
    thumbnail: video.thumbnail,
    playing: false,
    position: 0,
    updatedAt: Date.now()
  };

  await update(
    ref(database, `rooms/${state.roomCode}/state`),
    nextState
  );

  if (state.playerReady && state.player) {
    state.player.loadVideoById(video.videoId);
    state.player.pauseVideo();
  }

  await addActivity(`${getName()} selected ${video.title}`);
  showToast("Video selected.");
}

async function addToQueue(video) {
  if (!state.roomCode || !state.user) return;

  const itemReference = push(queueReference());

  await set(itemReference, {
    videoId: video.videoId,
    title: video.title,
    channel: video.channel,
    thumbnail: video.thumbnail,
    addedBy: state.user.uid,
    addedByName: getName(),
    addedAt: Date.now()
  });

  await addActivity(`${getName()} added ${video.title} to the queue`);
  showToast("Added to queue.");
}

async function playQueueItem(itemId) {
  const item = state.room?.queue?.[itemId];

  if (!item) return;

  await selectVideo({
    videoId: item.videoId,
    title: item.title,
    channel: item.channel,
    thumbnail: item.thumbnail
  });
}

async function removeQueueItem(itemId) {
  if (!state.roomCode) return;

  await remove(
    ref(database, `rooms/${state.roomCode}/queue/${itemId}`)
  );

  showToast("Removed from queue.");
}

async function clearQueue() {
  if (!state.roomCode) return;

  await remove(queueReference());
  await addActivity(`${getName()} cleared the queue`);
  showToast("Queue cleared.");
}

async function shuffleQueue() {
  const entries = Object.values(state.room?.queue || {});

  if (entries.length < 2) {
    showToast("Add at least two videos first.");
    return;
  }

  const shuffled = [...entries].sort(() => Math.random() - 0.5);

  const newQueue = {};

  shuffled.forEach((item, index) => {
    newQueue[`item_${Date.now()}_${index}`] = item;
  });

  await set(queueReference(), newQueue);
  await addActivity(`${getName()} shuffled the queue`);
  showToast("Queue shuffled.");
}

async function sendChatMessage(event) {
  event.preventDefault();

  const input = $("chatInput");
  const text = input?.value.trim();

  if (!text || !state.roomCode || !state.user) return;

  const messageReference = push(chatReference());

  await set(messageReference, {
    uid: state.user.uid,
    name: getName(),
    color: findCurrentUser()?.color || randomColor(),
    text: text.slice(0, 300),
    createdAt: Date.now()
  });

  input.value = "";
}

async function addActivity(text) {
  if (!state.roomCode) return;

  const activityReference = push(activityReference());

  await set(activityReference, {
    text: text.slice(0, 200),
    createdAt: Date.now()
  });
}

async function removeMember(uid) {
  if (!isHost() || uid === state.user.uid) return;

  await remove(
    ref(database, `rooms/${state.roomCode}/members/${uid}`)
  );

  await addActivity(`${getName()} removed a member`);
}

function findCurrentUser() {
  const members = state.room?.members || {};
  return members[state.user?.uid] || null;
}

async function searchYouTube() {
  const input = $("searchInput");
  const results = $("searchResults");
  const status = $("searchStatus");

  const query = input?.value.trim();

  if (!query) {
    status.textContent = "Enter a search term.";
    return;
  }

  if (
    !YOUTUBE_API_KEY ||
    YOUTUBE_API_KEY === "PASTE_YOUR_YOUTUBE_API_KEY_HERE"
  ) {
    status.textContent = "Add your YouTube API key in app.js first.";
    return;
  }

  status.textContent = "Searching...";
  results.innerHTML = "";

  try {
    const endpoint = new URL(
      "https://www.googleapis.com/youtube/v3/search"
    );

    endpoint.search = new URLSearchParams({
      part: "snippet",
      q: query,
      type: "video",
      maxResults: "12",
      videoEmbeddable: "true",
      key: YOUTUBE_API_KEY
    });

    const response = await fetch(endpoint);

    if (!response.ok) {
      const details = await response.text();
      console.error("YouTube API error:", details);
      throw new Error("YouTube search failed.");
    }

    const data = await response.json();

    const videos = (data.items || []).map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail:
        item.snippet.thumbnails?.medium?.url ||
        item.snippet.thumbnails?.default?.url ||
        ""
    }));

    renderSearchResults(videos);

    status.textContent = videos.length
      ? `${videos.length} results found.`
      : "No videos found.";
  } catch (error) {
    console.error(error);
    status.textContent = error.message || "Search failed.";
  }
}

function renderSearchResults(videos) {
  const results = $("searchResults");

  if (!results) return;

  results.innerHTML = videos.map(video => `
    <div class="searchItem">
      <img
        class="searchThumb"
        src="${escapeHtml(video.thumbnail)}"
        alt=""
      >

      <div class="searchInfo">
        <strong>${escapeHtml(video.title)}</strong>
        <small>${escapeHtml(video.channel)}</small>

        <div class="buttonRow">
          <button data-select-video="${escapeHtml(video.videoId)}">
            Play now
          </button>

          <button
            class="secondary"
            data-add-video="${escapeHtml(video.videoId)}"
          >
            Add to queue
          </button>
        </div>
      </div>
    </div>
  `).join("");

  videos.forEach(video => {
    const selectButton = document.querySelector(
      `[data-select-video="${CSS.escape(video.videoId)}"]`
    );

    const addButton = document.querySelector(
      `[data-add-video="${CSS.escape(video.videoId)}"]`
    );

    if (selectButton) {
      selectButton.onclick = () => selectVideo(video);
    }

    if (addButton) {
      addButton.onclick = () => addToQueue(video);
    }
  });
}

async function togglePlayPause() {
  if (!isHost()) {
    showToast("Only the host can control playback.");
    return;
  }

  if (!state.room?.state?.videoId) {
    showToast("Select a video first.");
    return;
  }

  const currentlyPlaying = Boolean(state.room.state.playing);
  const position = getCurrentPosition();

  await updateRoomState({
    playing: !currentlyPlaying,
    position
  });

  if (state.playerReady && state.player) {
    if (currentlyPlaying) {
      state.player.pauseVideo();
    } else {
      state.player.playVideo();
    }
  }
}

async function seekByButton(seconds) {
  if (!isHost()) {
    showToast("Only the host can seek.");
    return;
  }

  const duration = state.playerReady
    ? Number(state.player.getDuration() || 0)
    : 0;

  const nextPosition = Math.max(
    0,
    Math.min(getCurrentPosition() + seconds, duration || Infinity)
  );

  if (state.playerReady && state.player) {
    state.player.seekTo(nextPosition, true);
  }

  await updateRoomState({
    position: nextPosition
  });
}

async function seekFromBar() {
  if (!isHost()) {
    updateProgressBar();
    showToast("Only the host can seek.");
    return;
  }

  const duration = state.playerReady
    ? Number(state.player.getDuration() || 0)
    : 0;

  const value = Number($("seekBar")?.value || 0);
  const nextPosition = duration * value / 100;

  if (state.playerReady && state.player) {
    state.player.seekTo(nextPosition, true);
  }

  await updateRoomState({
    position: nextPosition
  });
}

async function goNext() {
  if (!isHost()) {
    showToast("Only the host can control playback.");
    return;
  }

  const entries = Object.entries(state.room?.queue || {});

  if (!entries.length) {
    showToast("Queue is empty.");
    return;
  }

  const currentVideoId = state.room?.state?.videoId;
  const currentIndex = entries.findIndex(
    ([, item]) => item.videoId === currentVideoId
  );

  const nextEntry = entries[(currentIndex + 1) % entries.length];

  if (nextEntry) {
    await playQueueItem(nextEntry[0]);
  }
}

async function goPrevious() {
  if (!isHost()) {
    showToast("Only the host can control playback.");
    return;
  }

  const entries = Object.entries(state.room?.queue || {});

  if (!entries.length) {
    showToast("Queue is empty.");
    return;
  }

  const currentVideoId = state.room?.state?.videoId;
  const currentIndex = entries.findIndex(
    ([, item]) => item.videoId === currentVideoId
  );

  const previousIndex =
    currentIndex <= 0 ? entries.length - 1 : currentIndex - 1;

  await playQueueItem(entries[previousIndex][0]);
}

async function syncNow() {
  const remoteState = state.room?.state;

  if (!remoteState?.videoId) {
    showToast("Nothing is playing.");
    return;
  }

  if (!state.playerReady || !state.player) {
    showToast("YouTube player is still loading.");
    return;
  }

  state.applyingRemoteState = true;

  if (state.player.getVideoData().video_id !== remoteState.videoId) {
    state.player.loadVideoById(remoteState.videoId);
  }

  state.player.seekTo(
    Number(remoteState.position || 0),
    true
  );

  if (remoteState.playing) {
    state.player.playVideo();
  } else {
    state.player.pauseVideo();
  }

  setTimeout(() => {
    state.applyingRemoteState = false;
  }, 500);

  showToast("Playback synchronized.");
}

function applyRemotePlayback() {
  const remoteState = state.room?.state;

  if (!remoteState || !state.playerReady || !state.player) {
    return;
  }

  const currentVideoId =
    state.player.getVideoData?.()?.video_id || "";

  if (remoteState.videoId && currentVideoId !== remoteState.videoId) {
    state.applyingRemoteState = true;
    state.player.cueVideoById(remoteState.videoId);

    setTimeout(() => {
      state.applyingRemoteState = false;
      syncNow();
    }, 500);

    return;
  }

  const localPlaying =
    state.player.getPlayerState?.() === YT.PlayerState.PLAYING;

  if (remoteState.playing && !localPlaying) {
    state.applyingRemoteState = true;
    state.player.playVideo();

    setTimeout(() => {
      state.applyingRemoteState = false;
    }, 500);
  }

  if (!remoteState.playing && localPlaying) {
    state.applyingRemoteState = true;
    state.player.pauseVideo();

    setTimeout(() => {
      state.applyingRemoteState = false;
    }, 500);
  }
}

function correctPlaybackDrift() {
  const remoteState = state.room?.state;

  if (
    !remoteState ||
    !remoteState.videoId ||
    !state.playerReady ||
    !state.player ||
    state.applyingRemoteState
  ) {
    return;
  }

  const remotePosition = Number(remoteState.position || 0);
  const localPosition = Number(state.player.getCurrentTime() || 0);
  const drift = Math.abs(localPosition - remotePosition);

  if (drift > 2) {
    state.applyingRemoteState = true;
    state.player.seekTo(remotePosition, true);

    setTimeout(() => {
      state.applyingRemoteState = false;
    }, 500);
  }
}

function updateProgressBar() {
  if (!state.playerReady || !state.player) return;

  const duration = Number(state.player.getDuration() || 0);
  const current = Number(state.player.getCurrentTime() || 0);

  if ($("seekBar")) {
    $("seekBar").value = duration
      ? String((current / duration) * 100)
      : "0";
  }

  if ($("currentTimeText")) {
    $("currentTimeText").textContent = formatTime(current);
  }

  if ($("durationText")) {
    $("durationText").textContent = formatTime(duration);
  }
}

function renderAll() {
  renderRoomInfo();
  renderPlaybackInfo();
  renderQueue();
  renderMembers();
  renderChat();
  renderActivity();
}

function renderRoomInfo() {
  if ($("roomCodeText")) {
    $("roomCodeText").textContent = state.roomCode || "------";
  }

  if ($("memberCount")) {
    $("memberCount").textContent = Object.keys(
      state.room?.members || {}
    ).length;
  }

  if ($("hostNotice")) {
    $("hostNotice").textContent = isHost()
      ? "You are the host. Your playback controls update the room."
      : "Only the host controls room playback.";
  }
}

function renderPlaybackInfo() {
  const playback = state.room?.state || {};

  if ($("nowPlayingTitle")) {
    $("nowPlayingTitle").textContent =
      playback.title || "Nothing playing";
  }

  if ($("nowPlayingChannel")) {
    $("nowPlayingChannel").textContent =
      playback.channel || "Choose a video from Search";
  }

  if ($("playPauseButton")) {
    $("playPauseButton").textContent =
      playback.playing ? "Pause" : "Play";
  }

  if ($("syncIndicator")) {
    $("syncIndicator").textContent =
      playback.videoId ? "Synced room" : "Not synced";
  }
}

function renderQueue() {
  const element = $("queueList");

  if (!element) return;

  const entries = Object.entries(state.room?.queue || {});

  if (!entries.length) {
    element.innerHTML =
      `<p class="muted">Queue is empty. Search for a video to add one.</p>`;
    return;
  }

  element.innerHTML = entries.map(([id, item]) => `
    <div class="queueItem">
      <img
        class="queueThumb"
        src="${escapeHtml(item.thumbnail)}"
        alt=""
      >

      <div class="queueInfo">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.channel || "")}</small>
        <small>Added by ${escapeHtml(item.addedByName || "Guest")}</small>
      </div>

      <button
        class="secondary"
        data-play-queue="${escapeHtml(id)}"
      >
        Play
      </button>

      <button
        class="danger"
        data-remove-queue="${escapeHtml(id)}"
      >
        ×
      </button>
    </div>
  `).join("");

  element.querySelectorAll("[data-play-queue]").forEach(button => {
    button.onclick = () => playQueueItem(button.dataset.playQueue);
  });

  element.querySelectorAll("[data-remove-queue]").forEach(button => {
    button.onclick = () => removeQueueItem(button.dataset.removeQueue);
  });
}

function renderMembers() {
  const element = $("membersList");

  if (!element) return;

  const entries = Object.entries(state.room?.members || {});

  element.innerHTML = entries.map(([uid, member]) => `
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
          ${uid === state.room?.hostId ? "Host · " : ""}
          ${member.online ? "Online" : "Offline"}
        </small>
      </div>

      ${
        isHost() && uid !== state.user?.uid
          ? `
            <button
              class="danger"
              data-remove-member="${escapeHtml(uid)}"
            >
              Remove
            </button>
          `
          : ""
      }
    </div>
  `).join("");

  element.querySelectorAll("[data-remove-member]").forEach(button => {
    button.onclick = () => removeMember(button.dataset.removeMember);
  });
}

function renderChat() {
  const element = $("chatMessages");

  if (!element) return;

  const messages = Object.values(state.room?.chat || {})
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

  if (!messages.length) {
    element.innerHTML = `<p class="muted">No messages yet.</p>`;
    return;
  }

  element.innerHTML = messages.map(message => `
    <div class="chatMessage">
      <div
        class="chatAvatar"
        style="background:${escapeHtml(message.color || "#4f46e5")}"
      >
        ${escapeHtml((message.name || "G").charAt(0).toUpperCase())}
      </div>

      <div class="chatContent">
        <strong>${escapeHtml(message.name || "Guest")}</strong>
        <small class="muted">
          ${escapeHtml(timeAgo(message.createdAt))}
        </small>
        <p>${escapeHtml(message.text)}</p>
      </div>
    </div>
  `).join("");

  element.scrollTop = element.scrollHeight;
}

function renderActivity() {
  const element = $("activityList");

  if (!element) return;

  const items = Object.values(state.room?.activity || {})
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 30);

  element.innerHTML = items.map(item => `
    <div class="activityItem">
      <span>•</span>
      <div>
        <div>${escapeHtml(item.text)}</div>
        <small>${escapeHtml(timeAgo(item.createdAt))}</small>
      </div>
    </div>
  `).join("") || `<p class="muted">No room activity yet.</p>`;
}

function initializeYouTubePlayer() {
  if (typeof YT === "undefined" || !YT.Player) {
    setTimeout(initializeYouTubePlayer, 500);
    return;
  }

  if (state.player) return;

  state.player = new YT.Player("player", {
    width: "100%",
    height: "100%",
    videoId: "",
    playerVars: {
      controls: 1,
      playsinline: 1,
      rel: 0,
      modestbranding: 1
    },
    events: {
      onReady: () => {
        state.playerReady = true;
        $("playerLoading")?.classList.add("hidden");
        applyRemotePlayback();
      },

      onStateChange: event => {
        if (state.applyingRemoteState) return;

        if (event.data === YT.PlayerState.PLAYING) {
          handlePlayerPlaying();
        }

        if (event.data === YT.PlayerState.PAUSED) {
          handlePlayerPaused();
        }

        if (event.data === YT.PlayerState.ENDED) {
          handlePlayerEnded();
        }
      },

      onError: event => {
        console.error("YouTube player error:", event.data);
        showToast("This YouTube video cannot be played.");
      }
    }
  });
}

async function handlePlayerPlaying() {
  if (!isHost() || state.applyingRemoteState) return;

  await updateRoomState({
    playing: true,
    position: getCurrentPosition()
  });
}

async function handlePlayerPaused() {
  if (!isHost() || state.applyingRemoteState) return;

  await updateRoomState({
    playing: false,
    position: getCurrentPosition()
  });
}

async function handlePlayerEnded() {
  if (!isHost() || state.applyingRemoteState) return;

  await updateRoomState({
    playing: false,
    position: 0
  });

  await goNext();
}

function switchTab(tabId) {
  document.querySelectorAll(".tabPanel").forEach(panel => {
    panel.classList.add("hidden");
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.remove("active");
  });

  $(tabId)?.classList.remove("hidden");

  document
    .querySelector(`[data-tab="${tabId}"]`)
    ?.classList.add("active");
}

function copyRoomCode() {
  if (!state.roomCode) return;

  navigator.clipboard
    .writeText(state.roomCode)
    .then(() => showToast("Room code copied."))
    .catch(() => showToast(`Room code: ${state.roomCode}`));
}

async function shareRoom() {
  if (!state.roomCode) return;

  const shareData = {
    title: "Join my SyncRoom",
    text: `Join my SyncRoom room: ${state.roomCode}`,
    url: location.href
  };

  if (navigator.share) {
    await navigator.share(shareData);
  } else {
    copyRoomCode();
  }
}

function loadSavedSettings() {
  const darkTheme =
    localStorage.getItem("syncroom-dark") !== "false";

  const largeControls =
    localStorage.getItem("syncroom-large-controls") === "true";

  const dataSaver =
    localStorage.getItem("syncroom-data-saver") === "true";

  document.documentElement.classList.toggle("light", !darkTheme);
  document.body.classList.toggle("largeControls", largeControls);

  if ($("darkThemeToggle")) {
    $("darkThemeToggle").checked = darkTheme;
  }

  if ($("largeControlsToggle")) {
    $("largeControlsToggle").checked = largeControls;
  }

  if ($("dataSaverToggle")) {
    $("dataSaverToggle").checked = dataSaver;
  }

  const savedName = localStorage.getItem("syncroom-name");

  if (savedName && $("nameInput")) {
    $("nameInput").value = savedName;
  }
}

function saveSettings() {
  const darkTheme = $("darkThemeToggle")?.checked ?? true;
  const largeControls = $("largeControlsToggle")?.checked ?? false;
  const dataSaver = $("dataSaverToggle")?.checked ?? false;

  localStorage.setItem("syncroom-dark", String(darkTheme));
  localStorage.setItem(
    "syncroom-large-controls",
    String(largeControls)
  );
  localStorage.setItem("syncroom-data-saver", String(dataSaver));

  document.documentElement.classList.toggle("light", !darkTheme);
  document.body.classList.toggle("largeControls", largeControls);

  showToast("Settings saved.");
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredInstall = event;
    $("installButton")?.classList.remove("hidden");
  });

  $("installButton")?.addEventListener("click", async () => {
    if (!state.deferredInstall) return;

    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;

    state.deferredInstall = null;
    $("installButton")?.classList.add("hidden");
  });
}

function setupEvents() {
  $("createRoomButton")?.addEventListener("click", createRoom);
  $("joinRoomButton")?.addEventListener("click", joinRoom);

  $("showJoinButton")?.addEventListener("click", () => {
    $("joinBox")?.classList.toggle("hidden");
  });

  $("copyRoomButton")?.addEventListener("click", copyRoomCode);
  $("shareRoomButton")?.addEventListener("click", shareRoom);
  $("leaveRoomButton")?.addEventListener("click", leaveRoom);

  $("searchButton")?.addEventListener("click", searchYouTube);

  $("searchInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      searchYouTube();
    }
  });

  $("chatForm")?.addEventListener("submit", sendChatMessage);

  $("playPauseButton")?.addEventListener(
    "click",
    togglePlayPause
  );

  $("previousButton")?.addEventListener(
    "click",
    goPrevious
  );

  $("nextButton")?.addEventListener(
    "click",
    goNext
  );

  $("syncNowButton")?.addEventListener(
    "click",
    syncNow
  );

  $("seekBar")?.addEventListener(
    "change",
    seekFromBar
  );

  $("shuffleButton")?.addEventListener(
    "click",
    shuffleQueue
  );

  $("clearQueueButton")?.addEventListener(
    "click",
    clearQueue
  );

  $("darkThemeToggle")?.addEventListener(
    "change",
    saveSettings
  );

  $("largeControlsToggle")?.addEventListener(
    "change",
    saveSettings
  );

  $("dataSaverToggle")?.addEventListener(
    "change",
    saveSettings
  );

  $("saveProfileButton")?.addEventListener(() => {
    const displayName = getName();
    saveName(displayName);
    showToast("Profile saved.");
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      switchTab(tab.dataset.tab);
    });
  });

  $("roomInput")?.addEventListener("input", event => {
    event.target.value = event.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  });

  $("nameInput")?.addEventListener("input", event => {
    saveName(event.target.value.slice(0, 24));
  });
}

window.onYouTubeIframeAPIReady = initializeYouTubePlayer;

setupEvents();
loadSavedSettings();
setupInstallPrompt();
initializeYouTubePlayer();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(error => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

console.log("SyncRoom app loaded.");
async function testFirebase() {
  try {
    const result = await signInAnonymously(auth);

    console.log("Firebase connected");
    console.log("Project:", auth.app.options.projectId);
    console.log("Anonymous UID:", result.user.uid);
  } catch (error) {
    console.error("Firebase error code:", error.code);
    console.error("Firebase error message:", error.message);
  }
}

testFirebase();
