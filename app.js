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

const state = {
  user: null,
  roomCode: null,
  room: null,
  stopRoomListener: null,
  player: null,
  playerReady: false,
  applyingRemote: false,
  syncTimer: null
};

const $ = id => document.getElementById(id);

const db = path => ref(database, path);

function showError(message) {
  const element = $("welcomeError");
  if (element) element.textContent = message || "";
  console.error(message);
}

function showToast(message) {
  const element = $("toast");

  if (!element) {
    console.log(message);
    return;
  }

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
  element.className = connected ? "online" : "offline";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getName() {
  const typedName = $("nameInput")?.value.trim();
  const savedName = localStorage.getItem("syncroom-name");

  return (typedName || savedName || "Guest").slice(0, 24);
}

function saveName() {
  localStorage.setItem("syncroom-name", getName());
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

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

function roomPath() {
  return `rooms/${state.roomCode}`;
}

function currentRoomRef() {
  return db(roomPath());
}

function currentMemberRef() {
  return db(`${roomPath()}/members/${state.user.uid}`);
}

function isHost() {
  return Boolean(
    state.user &&
    state.room &&
    state.room.hostId === state.user.uid
  );
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

    console.log("Firebase connected");
    console.log("Anonymous UID:", state.user.uid);

    return state.user;
  } catch (error) {
    setConnection(false);

    console.error("Firebase error code:", error.code);
    console.error("Firebase error:", error.message);

    if (error.code === "auth/invalid-api-key") {
      throw new Error(
        "Invalid Firebase API key. Check firebase-config.js."
      );
    }

    if (error.code === "auth/operation-not-allowed") {
      throw new Error(
        "Enable Anonymous Authentication in Firebase Console."
      );
    }

    throw new Error(error.message || "Firebase login failed.");
  }
}

async function createRoom() {
  try {
    showError("");
    await signIn();
    saveName();

    const code = createRoomCode();
    state.roomCode = code;

    const now = Date.now();

    await set(currentRoomRef(), {
      code,
      hostId: state.user.uid,
      createdAt: now,
      updatedAt: now,

      state: {
        videoId: "",
        title: "",
        channel: "",
        thumbnail: "",
        playing: false,
        position: 0,
        updatedAt: now
      },

      members: {
        [state.user.uid]: {
          name: getName(),
          color: randomColor(),
          joinedAt: now,
          online: true
        }
      },

      queue: {},
      chat: {},
      activity: {}
    });

    await addActivity(`${getName()} created the room`);
    await openRoom();
  } catch (error) {
    state.roomCode = null;
    showError(error.message || "Could not create room.");
  }
}

async function joinRoom() {
  try {
    showError("");
    await signIn();
    saveName();

    const code = $("roomInput")?.value
      .trim()
      .toUpperCase();

    if (!code || !/^[A-Z0-9]{6}$/.test(code)) {
      showError("Enter a valid six-character room code.");
      return;
    }

    state.roomCode = code;

    const snapshot = await get(currentRoomRef());

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

    await update(currentMemberRef(), {
      name: getName(),
      color: randomColor(),
      joinedAt: Date.now(),
      online: true
    });

    await addActivity(`${getName()} joined the room`);
    await openRoom();
  } catch (error) {
    state.roomCode = null;
    showError(error.message || "Could not join room.");
  }
}

async function openRoom() {
  $("welcomeView")?.classList.add("hidden");
  $("roomView")?.classList.remove("hidden");

  if ($("roomCodeText")) {
    $("roomCodeText").textContent = state.roomCode;
  }

  await update(currentMemberRef(), {
    online: true
  });

  onDisconnect(currentMemberRef()).update({
    online: false,
    lastSeen: serverTimestamp()
  });

  if (state.stopRoomListener) {
    state.stopRoomListener();
  }

  state.stopRoomListener = onValue(
    currentRoomRef(),
    snapshot => {
      if (!snapshot.exists()) {
        showToast("Room was deleted.");
        leaveRoom();
        return;
      }

      state.room = snapshot.val();

      setConnection(true);
      render();
      applyRemotePlayback();
    },
    error => {
      console.error("Database listener error:", error);
      setConnection(false);
      showError(error.message);
    }
  );

  clearInterval(state.syncTimer);
  state.syncTimer = setInterval(applyRemotePlayback, 4000);

  render();
}

async function leaveRoom() {
  try {
    if (state.roomCode && state.user) {
      await update(currentMemberRef(), {
        online: false,
        lastSeen: serverTimestamp()
      });
    }
  } catch (error) {
    console.warn("Leave error:", error);
  }

  if (state.stopRoomListener) {
    state.stopRoomListener();
  }

  clearInterval(state.syncTimer);

  state.room = null;
  state.roomCode = null;
  state.stopRoomListener = null;

  $("roomView")?.classList.add("hidden");
  $("welcomeView")?.classList.remove("hidden");

  setConnection(false);
}

async function addActivity(text) {
  if (!state.roomCode) return;

  await set(
    push(db(`${roomPath()}/activity`)),
    {
      text: text.slice(0, 200),
      createdAt: Date.now()
    }
  );
}

async function updatePlayback(values) {
  if (!isHost()) {
    showToast("Only the host can control playback.");
    return;
  }

  await update(db(`${roomPath()}/state`), {
    ...(state.room.state || {}),
    ...values,
    updatedAt: Date.now()
  });
}

function playerPosition() {
  if (
    state.playerReady &&
    state.player &&
    typeof state.player.getCurrentTime === "function"
  ) {
    return Number(state.player.getCurrentTime() || 0);
  }

  return Number(state.room?.state?.position || 0);
}

async function selectVideo(video) {
  if (!isHost()) {
    showToast("Only the host can select a video.");
    return;
  }

  await set(db(`${roomPath()}/state`), {
    videoId: video.videoId,
    title: video.title,
    channel: video.channel,
    thumbnail: video.thumbnail || "",
    playing: false,
    position: 0,
    updatedAt: Date.now()
  });

  await addActivity(`${getName()} selected ${video.title}`);
  showToast("Video selected.");
}

async function addToQueue(video) {
  const queueItem = push(db(`${roomPath()}/queue`));

  await set(queueItem, {
    videoId: video.videoId,
    title: video.title,
    channel: video.channel,
    thumbnail: video.thumbnail || "",
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
  await remove(
    db(`${roomPath()}/queue/${itemId}`)
  );

  showToast("Removed from queue.");
}

async function clearQueue() {
  await remove(db(`${roomPath()}/queue`));
  await addActivity(`${getName()} cleared the queue`);
  showToast("Queue cleared.");
}

async function sendChat(event) {
  event.preventDefault();

  const input = $("chatInput");
  const text = input?.value.trim();

  if (!text) return;

  await set(
    push(db(`${roomPath()}/chat`)),
    {
      uid: state.user.uid,
      name: getName(),
      text: text.slice(0, 300),
      createdAt: Date.now()
    }
  );

  input.value = "";
}

async function togglePlay() {
  if (!isHost()) {
    showToast("Only the host can control playback.");
    return;
  }

  const current = Boolean(state.room?.state?.playing);
  const position = playerPosition();

  await updatePlayback({
    playing: !current,
    position
  });

  if (state.playerReady && state.player) {
    if (current) {
      state.player.pauseVideo();
    } else {
      state.player.playVideo();
    }
  }
}

async function seek(seconds) {
  if (!isHost()) {
    showToast("Only the host can seek.");
    return;
  }

  const nextPosition = Math.max(
    0,
    playerPosition() + seconds
  );

  if (state.playerReady && state.player) {
    state.player.seekTo(nextPosition, true);
  }

  await updatePlayback({
    position: nextPosition
  });
}

async function nextVideo() {
  if (!isHost()) return;

  const entries = Object.entries(state.room?.queue || {});

  if (!entries.length) {
    showToast("Queue is empty.");
    return;
  }

  const currentVideo = state.room?.state?.videoId;

  const index = entries.findIndex(
    ([, item]) => item.videoId === currentVideo
  );

  const next = entries[(index + 1) % entries.length];

  if (next) {
    await playQueueItem(next[0]);
  }
}

async function searchYouTube() {
  const query = $("searchInput")?.value.trim();
  const output = $("searchResults");
  const status = $("searchStatus");

  if (!query) {
    if (status) status.textContent = "Enter a search term.";
    return;
  }

  const key =
    window.YOUTUBE_API_KEY ||
    localStorage.getItem("youtube-api-key");

  if (!key) {
    if (status) {
      status.textContent =
        "Add a YouTube API key before searching.";
    }
    return;
  }

  if (status) status.textContent = "Searching...";
  if (output) output.innerHTML = "";

  try {
    const url = new URL(
      "https://www.googleapis.com/youtube/v3/search"
    );

    url.search = new URLSearchParams({
      part: "snippet",
      q: query,
      type: "video",
      maxResults: "12",
      videoEmbeddable: "true",
      key
    });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("YouTube search failed.");
    }

    const data = await response.json();

    const videos = (data.items || []).map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail:
        item.snippet.thumbnails?.medium?.url || ""
    }));

    renderSearchResults(videos);

    if (status) {
      status.textContent =
        videos.length ? "Results found." : "No videos found.";
    }
  } catch (error) {
    console.error(error);

    if (status) {
      status.textContent = error.message;
    }
  }
}

function renderSearchResults(videos) {
  const output = $("searchResults");

  if (!output) return;

  output.innerHTML = videos.map(video => `
    <div class="searchItem">
      <img
        src="${escapeHtml(video.thumbnail)}"
        class="searchThumb"
        alt=""
      >

      <div class="searchInfo">
        <strong>${escapeHtml(video.title)}</strong>
        <small>${escapeHtml(video.channel)}</small>

        <div class="buttonRow">
          <button data-play="${escapeHtml(video.videoId)}">
            Play now
          </button>

          <button
            class="secondary"
            data-queue="${escapeHtml(video.videoId)}"
          >
            Add to queue
          </button>
        </div>
      </div>
    </div>
  `).join("");

  videos.forEach(video => {
    document
      .querySelector(`[data-play="${CSS.escape(video.videoId)}"]`)
      ?.addEventListener("click", () => selectVideo(video));

    document
      .querySelector(`[data-queue="${CSS.escape(video.videoId)}"]`)
      ?.addEventListener("click", () => addToQueue(video));
  });
}

function render() {
  renderRoomInfo();
  renderPlayback();
  renderMembers();
  renderQueue();
  renderChat();
  renderActivity();
}

function renderRoomInfo() {
  if ($("roomCodeText")) {
    $("roomCodeText").textContent =
      state.roomCode || "------";
  }

  if ($("memberCount")) {
    $("memberCount").textContent = Object.keys(
      state.room?.members || {}
    ).length;
  }

  if ($("hostNotice")) {
    $("hostNotice").textContent = isHost()
      ? "You are the host."
      : "Only the host controls playback.";
  }
}

function renderPlayback() {
  const playback = state.room?.state || {};

  if ($("nowPlayingTitle")) {
    $("nowPlayingTitle").textContent =
      playback.title || "Nothing playing";
  }

  if ($("nowPlayingChannel")) {
    $("nowPlayingChannel").textContent =
      playback.channel || "Select a video";
  }

  if ($("playPauseButton")) {
    $("playPauseButton").textContent =
      playback.playing ? "Pause" : "Play";
  }
}

function renderMembers() {
  const output = $("membersList");

  if (!output) return;

  output.innerHTML = Object.entries(
    state.room?.members || {}
  ).map(([uid, member]) => `
    <div class="memberItem">
      <strong>${escapeHtml(member.name || "Guest")}</strong>
      <small>
        ${uid === state.room.hostId ? "Host · " : ""}
        ${member.online ? "Online" : "Offline"}
      </small>
    </div>
  `).join("");
}

function renderQueue() {
  const output = $("queueList");

  if (!output) return;

  const items = Object.entries(state.room?.queue || {});

  if (!items.length) {
    output.innerHTML = `<p class="muted">Queue is empty.</p>`;
    return;
  }

  output.innerHTML = items.map(([id, item]) => `
    <div class="queueItem">
      <img
        src="${escapeHtml(item.thumbnail || "")}"
        class="queueThumb"
        alt=""
      >

      <div class="queueInfo">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.channel || "")}</small>
      </div>

      <button data-play-queue="${escapeHtml(id)}">
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

  output.querySelectorAll("[data-play-queue]").forEach(button => {
    button.addEventListener(
      "click",
      () => playQueueItem(button.dataset.playQueue)
    );
  });

  output.querySelectorAll("[data-remove-queue]").forEach(button => {
    button.addEventListener(
      "click",
      () => removeQueueItem(button.dataset.removeQueue)
    );
  });
}

function renderChat() {
  const output = $("chatMessages");

  if (!output) return;

  const messages = Object.values(
    state.room?.chat || {}
  ).sort((a, b) => a.createdAt - b.createdAt);

  output.innerHTML = messages.map(message => `
    <div class="chatMessage">
      <strong>${escapeHtml(message.name || "Guest")}</strong>
      <span>${escapeHtml(message.text)}</span>
    </div>
  `).join("");

  output.scrollTop = output.scrollHeight;
}

function renderActivity() {
  const output = $("activityList");

  if (!output) return;

  const items = Object.values(
    state.room?.activity || {}
  ).sort((a, b) => b.createdAt - a.createdAt);

  output.innerHTML = items.slice(0, 30).map(item => `
    <div class="activityItem">
      ${escapeHtml(item.text)}
    </div>
  `).join("");
}

function applyRemotePlayback() {
  const remote = state.room?.state;

  if (
    !remote?.videoId ||
    !state.playerReady ||
    !state.player
  ) {
    return;
  }

  const currentVideo =
    state.player.getVideoData?.()?.video_id || "";

  if (currentVideo !== remote.videoId) {
    state.applyingRemote = true;
    state.player.cueVideoById(remote.videoId);

    setTimeout(() => {
      state.applyingRemote = false;
      applyRemotePlayback();
    }, 700);

    return;
  }

  const currentTime =
    Number(state.player.getCurrentTime?.() || 0);

  if (Math.abs(currentTime - Number(remote.position || 0)) > 3) {
    state.applyingRemote = true;

    state.player.seekTo(
      Number(remote.position || 0),
      true
    );

    setTimeout(() => {
      state.applyingRemote = false;
    }, 500);
  }

  state.applyingRemote = true;

  if (remote.playing) {
    state.player.playVideo();
  } else {
    state.player.pauseVideo();
  }

  setTimeout(() => {
    state.applyingRemote = false;
  }, 500);
}

function setupYouTubePlayer() {
  if (!window.YT || !YT.Player) {
    setTimeout(setupYouTubePlayer, 500);
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
        applyRemotePlayback();
      },

      onStateChange: async event => {
        if (state.applyingRemote || !isHost()) return;

        if (event.data === YT.PlayerState.PLAYING) {
          await updatePlayback({
            playing: true,
            position: playerPosition()
          });
        }

        if (event.data === YT.PlayerState.PAUSED) {
          await updatePlayback({
            playing: false,
            position: playerPosition()
          });
        }

        if (event.data === YT.PlayerState.ENDED) {
          await updatePlayback({
            playing: false,
            position: 0
          });

          await nextVideo();
        }
      }
    }
  });
}

function setupEvents() {
  $("createRoomButton")?.addEventListener(
    "click",
    createRoom
  );

  $("joinRoomButton")?.addEventListener(
    "click",
    joinRoom
  );

  $("leaveRoomButton")?.addEventListener(
    "click",
    leaveRoom
  );

  $("playPauseButton")?.addEventListener(
    "click",
    togglePlay
  );

  $("previousButton")?.addEventListener(
    "click",
    () => seek(-10)
  );

  $("nextButton")?.addEventListener(
    "click",
    () => seek(10)
  );

  $("nextVideoButton")?.addEventListener(
    "click",
    nextVideo
  );

  $("searchButton")?.addEventListener(
    "click",
    searchYouTube
  );

  $("searchInput")?.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") searchYouTube();
    }
  );

  $("chatForm")?.addEventListener(
    "submit",
    sendChat
  );

  $("clearQueueButton")?.addEventListener(
    "click",
    clearQueue
  );

  $("roomInput")?.addEventListener(
    "input",
    event => {
      event.target.value = event.target.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
    }
  );

  $("nameInput")?.addEventListener(
    "input",
    saveName
  );
}

window.onYouTubeIframeAPIReady = setupYouTubePlayer;

async function startApp() {
  setupEvents();

  const savedName = localStorage.getItem("syncroom-name");

  if (savedName && $("nameInput")) {
    $("nameInput").value = savedName;
  }

  try {
    await signIn();
  } catch (error) {
    showError(error.message);
  }

  setupYouTubePlayer();
}

startApp();
signIn()
  .then(() => {
    console.log("Backend test passed");
  })
  .catch(error => {
    console.error("Backend test failed:", error);
  });
