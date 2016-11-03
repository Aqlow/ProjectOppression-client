'use strict';

const semver = require('semver');
const fs = require('fs');
const request = require('request');
const shell = require('electron').shell;
var ipc = require('electron').ipcRenderer;
var clientData = { permissions: [] };

window.onload = function() {
  ipc.on('check-update', (event, version) => {
    var check = 'https://198.100.146.10:8898/release/version.txt';
    var req = new XMLHttpRequest();
    req.addEventListener('load', function() {
      var content = this.responseText.trim();
      var needsUpdate = semver.lt(version, content);
      if(needsUpdate) {
        $('#update-dialog').modal(true);
      }
    });
    req.open('GET', check);
    req.send();
  });

  if(typeof localStorage.lastX === 'string') {
    try {
      ipc.send('settings-bounds', {
        x: parseInt(localStorage.lastX),
        y: parseInt(localStorage.lastY),
        width: parseInt(localStorage.lastWidth),
        height: parseInt(localStorage.lastHeight)
      });
    }
    catch(e) {}
  }
  if(localStorage.lastMaximized) {
    ipc.send('settings-maximized', localStorage.lastMaximized);
  }
  ipc.send('window-show');

  var requestSession = function(register) {
    if(!socket.connected) return;

    socket.emit('authenticate', {
      username: clientData.username,
      password: clientData.password,
      register: !!register,
      room: localStorage.lastRoom
    });
  };

  global.socket = null;
  global.createSocket = function createSocket() {
    socket = io('https://198.100.146.10:8898', {secure: true});
    socket.on('connect', function() {
      if(typeof clientData.username === 'string' && typeof clientData.password === 'string') {
        requestSession();
      }
      else {
        $('#connect').modal('show');
      }
    });
    socket.on('disconnect', function() {
      setConnected(false);
      videoPlayer.src(null);
      clientData.lastPlayback = null;
      clientData.estimatedPlayback = null;
      videoQueue = [];
      renderQueue();
      $('#room-label > a').html('');
    });
    socket.on('authentication', function(result) {
      if(result.username) {
        setConnected(true);
        socket.username = result.username;

        $('.modal').modal('hide');
      }
      else {
        if(result.redirect === 'connect') {
          $('#connect-user').val(clientData.username);
          $('.modal:not(#connect)').modal('hide');
          $('#connect').modal('show');
        }
        else if(result.redirect === 'register') {
          $('#register-user').val(clientData.username);
          $('#register-pass').val('');
          $('#register-pass-confirm').val('');
          $('.modal:not(#register)').modal('hide');
          $('#register').modal('show');
          $('#register-pass').focus();
        }
        else if(result.redirect === 'login') {
          $('#login-user').val(clientData.username);
          $('#login-pass').val('');
          $('.modal:not(#login)').modal('hide');
          $('#login').modal('show');
          $('#login-pass').focus();
        }

        if(result.error && result.highlight) {
          showError(result.highlight, '#' + result.redirect + '-error', result.error, 3000);
        }
      }
    });
    socket.on('permissions', function(permissions) {
      clientData.permissions = permissions;
      renderMembers();
    });
    socket.on('invalid session', function() {
      setConnected(false);
      requestSession();
    });
    socket.on('room', function(room) {
      localStorage.lastRoom = room;
      $('#room-label > a').html('#' + room +' <span class="caret"></span>');
    });
    socket.on('viewers', function(viewers) {
      if(viewers === null) viewers = {};
      videoPlayerControls.viewers = Object.keys(viewers).filter(function(viewer) {
        return viewer !== socket.username;
      });
      clientData.viewers = viewers;
      renderMembers();
    });
    socket.on('queue', function(queue) {
      videoQueue = queue;
      renderQueue();
    });
    socket.on('playback', function(playbackObj) {
      playbackObj.time = Date.now();
      clientData.lastPlayback = playbackObj;

      clientData.estimatedPlayback = {
        paused: function() {
          return playbackObj.paused;
        },
        currentTime: function() {
          if(playbackObj.paused) {
            return playbackObj.currentTime;
          }
          else {
            return playbackObj.currentTime + (Date.now() - playbackObj.time);
          }
        }
      };

      var serverURL = playbackObj.videoURL;
      if(mirroring && clientData.lastServerURL != serverURL) {
        $('#set-local').text('Set local mirror');
        mirroring = false;
      }
      clientData.lastServerURL = serverURL;
      if(videoPlayer.src() !== serverURL && !mirroring) {
        if(!serverURL || !serverURL.match(/^[a-z]+:\/\/.+/)) {
          videoPlayer.src(null);
        }
        else {
          videoPlayer.src(serverURL);
        }
      }

      updatePlayback();
    });
    socket.on('chat', function(message) {
      var isScrolledDown = $('#chat-messages')[0].scrollHeight - $('#chat-messages').height() - 10 <= $('#chat-messages').scrollTop();
      chatLog.push(message);
      renderChatMessage(message);

      updateChatScroll();
      if(isScrolledDown) {
        $('#chat-messages').scrollTop($('#chat-messages')[0].scrollHeight - $('#chat-messages').height() + 10);
      }
    });
  }
  createSocket();

  function updatePlayback() {
    if(!clientData.estimatedPlayback) return;

    serverPaused = clientData.estimatedPlayback.paused();

    if(serverPaused && !videoPlayer.paused()) {
      videoPlayer.pause();
    }
    else if(!serverPaused && videoPlayer.paused() && (clientData.estimatedPlayback.currentTime() / 1000 + 2) < videoPlayer.duration()) {
      videoPlayer.play();
    }

    if(Math.abs(videoPlayer.currentTime() - (clientData.estimatedPlayback.currentTime() / 1000)) > 2) {
      videoPlayer.currentTime(clientData.estimatedPlayback.currentTime() / 1000);
    }
  }
  setInterval(updatePlayback, 300);

  function renderMembers() {
    var members = clientData.viewers || {};

    var membersElement = document.querySelector('#members-group');
    while(membersElement.firstChild) {
      membersElement.removeChild(membersElement.firstChild);
    }
    for(var member in members) {
      var group = members[member].group;

      var memberElement = document.createElement('li');
      memberElement.classList.add('list-group-item');

      var iconBan = document.createElement('span');
      iconBan.style.color = 'red';
      iconBan.setAttribute('title', 'Ban');
      iconBan.classList.add('glyphicon', 'glyphicon-remove', 'members-icon');
      iconBan.setAttribute('aria-hidden', 'true');
      iconBan.setAttribute('projoppr-action', 'member-ban');
      iconBan.setAttribute('projoppr-user', member);

      var iconKick = document.createElement('span');
      iconKick.setAttribute('title', 'Kick');
      iconKick.classList.add('glyphicon', 'glyphicon-remove', 'members-icon');
      iconKick.setAttribute('aria-hidden', 'true');
      iconKick.setAttribute('projoppr-action', 'member-kick');
      iconKick.setAttribute('projoppr-user', member);

      var username = document.createElement('span');
      username.classList.add('queue-title');
      username.setAttribute('title', member);
      username.appendChild(document.createTextNode(member));

      if(clientData.permissions.indexOf('ban') > -1 && clientData.permissions.indexOf('group.room.' + group) > -1)
        memberElement.appendChild(iconBan);
      if(clientData.permissions.indexOf('kick') > -1 && clientData.permissions.indexOf('group.room.' + group) > -1)
        memberElement.appendChild(iconKick);
      memberElement.appendChild(username);
      membersElement.appendChild(memberElement);
    }
  }

  $('#queue-panel > .panel-heading').click(function() {
    var body = $('#queue-panel > .panel-body');

    if(body.attr('projoppr-closed') !== 'true') {
      $('#queue-panel > .panel-heading > h3 > span').removeClass('caret').addClass('caret-right');
      body.animate({
        height: '0px'
      }, {
        progress: adjustChatSizing,
        complete: adjustChatSizing
      });
      body.attr('projoppr-closed', 'true');
    }
    else {
      $('#queue-panel > .panel-heading > h3 > span').removeClass('caret-right').addClass('caret');
      body.animate({
        height: '150px'
      }, {
        progress: adjustChatSizing,
        complete: adjustChatSizing
      });
      body.attr('projoppr-closed', 'false');
    }
  });

  $('#members-group').click(function(e) {
    if(!connected) return;
    var action = e.target.getAttribute('projoppr-action');
    var user = e.target.getAttribute('projoppr-user');

    if(action === 'member-ban') {
      sendChat(['ban', user]);
    }
    else if(action === 'member-kick') {
      sendChat(['kick', user]);
    }
  });

  $('#members-toggle').click(function() {
    $('#members').modal('show');
  });

  $('#joinroom-toggle').click(function() {
    $('#joinroom').modal('show');
  })

  $('#joinroom-button').click(function() {
    var room = $('#joinroom-room').val();
    if(!room) room = '##welcome';

    sendChat(['room', room]);
    $('#joinroom').modal('hide');
  });

  $('#joinroom').keydown(function(e) {
    if(e.keyCode === 13) { // enter
      $('#joinroom-button').click();
    }
  });

  $('#update-button').click(function() {
    var url = 'https://aqlow.me/release/projoppr-' + process.platform + '-' + process.arch + '.zip';
    shell.openExternal(url);
    $('#update-dialog').modal('hide');
  });

  ipc.on('update-available', function() {
    $('#update-dialog').modal('show');
  });

  ipc.on('update-status', function(event, status) {
    $('#update-status').modal('show');
    $('#update-status-content').css('width', status + '%');
    $('#update-status-content').attr('aria-valuenow', status);
  });

  ipc.on('settings-bounds', function(event, bounds) {
    localStorage.lastX = bounds.x;
    localStorage.lastY = bounds.y;
    localStorage.lastWidth = bounds.width;
    localStorage.lastHeight = bounds.height;
  });

  ipc.on('settings-maximized', function(event, maximized) {
    localStorage.lastMaximized = maximized;
  });

  var connected = false;
  var reconnecting = true;

  var serverPaused = true;

  var chatLog = [];
  var chatSendQueue = [];
  var chatSendLog = [];
  var chatSendIndex = -1;

  var videoQueue = [];

  var mirroring = false;

  var youtubeURLs = {};

  function sendChat(message) {
    if(Array.isArray(message)) {
      for(var i = 0; i < message.length; i++) {
        message[i] = '' + message[i];
      }
    }
    else {
      message = '' + message;
    }
    socket.emit('chat', message);
  }

  var entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': '&quot;',
    "'": '&#39;',
    "/": '&#x2F;'
  };

  String.prototype.escapeHTML = function() {
    return this.replace(/[&<>"'\/]/g, function (s) {
      return entityMap[s];
    });
  }

  var deepEquals = function(obj1, obj2) {
    for(var key in obj1) {
      var value1 = obj1[key];
      var value2 = obj2[key];

      if(typeof value1 !== typeof value2) return false;
      if(typeof value1 === 'object') {
        if(!deepEquals(value1, value2)) {
          return false;
        }
      }
      else {
        if(value1 !== value2) {
          return false;
        }
      }
    }

    for(var key in obj2) {
      if(typeof obj1[key] === 'undefined') return false;
    }

    return true;
  }

  $('#queue-panel > .panel-body > ul.list-group').click(function(e) {
    if(!connected) return;
    var action = e.target.getAttribute('projoppr-action');
    var parent = e.target.parentElement;
    var index = parseInt(parent.getAttribute('projoppr-index'));

    if(action === 'add-youtube') {
      $('#seturl-youtube').modal('show');
    }
    else if(action === 'add-url') {
      $('#seturl').modal('show');
    }
    else if(action === 'queue-play') {
      sendChat(['seturl', videoQueue[index].ourl]);
    }
    else if(action === 'queue-delete') {
      sendChat(['queue', 'remove', videoQueue[index].id]);
    }
    else if(action === 'queue-move-up') {
      sendChat(['queue', 'move', videoQueue[index].id, index - 1]);
    }
    else if(action === 'queue-move-down') {
      sendChat(['queue', 'move', videoQueue[index].id, index + 1]);
    }
  });
  $('#queue-menu > ul').click(function(e) {
    if(!connected) return;
    var action = e.target.getAttribute('projoppr-action');
    var parent = e.target.parentElement.parentElement.parentElement;
    var index = parseInt(parent.getAttribute('projoppr-index'));

    if(action === 'add-youtube') {
      $('#seturl-youtube').modal('show');
    }
    else if(action === 'add-url') {
      $('#seturl').modal('show');
    }
    else if(action === 'queue-play') {
      sendChat(['seturl', videoQueue[index].ourl]);
    }
    else if(action === 'queue-delete') {
      sendChat(['queue', 'remove', videoQueue[index].id]);
    }
    else if(action === 'queue-move-up') {
      sendChat(['queue', 'move', videoQueue[index].id, index - 1]);
    }
    else if(action === 'queue-move-down') {
      sendChat(['queue', 'move', videoQueue[index].id, index + 1]);
    }
  });
  function renderQueue() {
    // MENU
    var queueUl = $('#queue-menu > ul');
    var all = '';
    if(videoQueue.length === 0) {
      all += '<li><a href="#" style="font-style: italic" disabled>No videos</a></li>';
    }
    else {
      var submenuStart = '<ul class="dropdown-menu">';
      submenuStart += '<li><a href="#" tabindex="-1" style="font-weight: bold" projoppr-action="queue-play">Play</a></li>';
      submenuStart += '<li><a href="#" tabindex="-1" style="font-weight: bold" projoppr-action="queue-delete">Delete</a></li>';
      var submenuEnd = '</ul>';
      for(var i = 0; i < videoQueue.length; i++) {
        var videoInfo = videoQueue[i];
        var title = videoInfo.title;
        var maxLength = 40;
        if(title.length > maxLength) {
          title = title.substring(0, maxLength - 1) + '...';
        }
        all += '<li class="dropdown-submenu" projoppr-index="' + i + '"><a tabindex="-1" href="#">' + title + '</a>';
        all += submenuStart;
        if(i !== 0) all += '<li><a href="#" tabindex="-1" style="font-weight: bold" projoppr-action="queue-move-up">Move up</a></li>';
        if(i !== videoQueue.length - 1) all += '<li><a href="#" tabindex="-1" style="font-weight: bold" projoppr-action="queue-move-down">Move down</a></li>';
        all += submenuEnd;
        all += '</li>';
      }
    }
    all += '<li><a href="#" style="font-weight: bold" projoppr-action="add-url">Add video - raw URL</a></li>';
    all += '<li><a href="#" style="font-weight: bold" projoppr-action="add-youtube">Add video - YouTube</a></li>';
    queueUl.html(all);

    // PANEL
    var ul = $('#queue-panel > .panel-body > ul');
    ul.html('');
    for(var i = 0; i < videoQueue.length; i++) {
      var videoInfo = videoQueue[i];
      var row = document.createElement('li');
      row.classList.add('list-group-item');
      row.setAttribute('projoppr-index', i);

      var iconPlay = document.createElement('span');
      iconPlay.classList.add('glyphicon', 'glyphicon-play', 'queue-icon');
      iconPlay.setAttribute('aria-hidden', 'true');
      iconPlay.setAttribute('projoppr-action', 'queue-play');

      var iconUp = document.createElement('span');
      iconUp.classList.add('glyphicon', 'glyphicon-arrow-up', 'queue-icon');
      if(i === 0) iconUp.classList.add('disabled');
      iconUp.setAttribute('aria-hidden', 'true');
      iconUp.setAttribute('projoppr-action', 'queue-move-up');

      var iconDown = document.createElement('span');
      iconDown.classList.add('glyphicon', 'glyphicon-arrow-down', 'queue-icon');
      if(i === videoQueue.length - 1) iconDown.classList.add('disabled');
      iconDown.setAttribute('aria-hidden', 'true');
      iconDown.setAttribute('projoppr-action', 'queue-move-down');

      var iconDelete = document.createElement('span');
      iconDelete.classList.add('glyphicon', 'glyphicon-remove', 'queue-icon');
      iconDelete.setAttribute('aria-hidden', 'true');
      iconDelete.setAttribute('projoppr-action', 'queue-delete');

      var title = document.createElement('span');
      title.classList.add('queue-title');
      title.setAttribute('title', videoInfo.title);
      title.appendChild(document.createTextNode(videoInfo.title));

      row.appendChild(iconDelete);
      row.appendChild(iconDown);
      row.appendChild(iconUp);
      row.appendChild(iconPlay);
      row.appendChild(title);
      ul[0].appendChild(row);
    }
  }
  renderQueue();

  function renderChat() {
    var isScrolledDown = ($('#chat-messages')[0].scrollHeight - $('#chat-messages').height() - 10 <= $('#chat-messages').scrollTop());

    var all = '';

    for(var i = 0; i < chatLog.length; i++) {
      if(chatLog[i].status)
        all += '<p class="message status-message"><span class="message-name">' + chatLog[i].user + "</span>" + chatLog[i].message.escapeHTML() + '</p>';
      else
        all += '<p class="message chat-message"><span class="message-name">' + chatLog[i].user + '</span>: ' + chatLog[i].message.escapeHTML() + '</p>';
    }
    $('#chat-messages').html(all);

    if($('#chat-messages-container').height() < $('#chat-messages')[0].scrollHeight) {
      $('#chat-messages').css('height', $('#chat-messages-container').height());
      $('#chat-messages').css('overflow-y', 'scroll');
    }
    else {
      $('#chat-messages').css('height', 'initial');
      $('#chat-messages').css('overflow-y', 'hidden');
    }

    if(isScrolledDown) {
      $('#chat-messages').scrollTop($('#chat-messages')[0].scrollHeight - $('#chat-messages').height() + 10);
    }
  }
  function renderChatMessage(message) {
    var element = document.createElement('p');
    element.classList.add('message', message.status ? 'status-message' : 'chat-message');
    if(message.user) {
      var span = document.createElement('span');
      span.classList.add('message-name');
      span.appendChild(document.createTextNode(message.user));
      element.appendChild(span);
    }
    element.appendChild(document.createTextNode(message.status ? message.message : ': ' + message.message));
    document.querySelector('#chat-messages').appendChild(element);
  }
  function updateChatScroll() {
    if($('#chat-messages-container').height() < $('#chat-messages')[0].scrollHeight) {
      $('#chat-messages').css('height', $('#chat-messages-container').height());
      $('#chat-messages').css('overflow-y', 'scroll');
    }
    else {
      $('#chat-messages').css('height', 'initial');
      $('#chat-messages').css('overflow-y', 'hidden');
    }
  }

  $('#chat-text').keydown(function(e) {
    if(e.keyCode === 13) { // enter
      sendChat($('#chat-text').val());
      if(chatSendLog.length < 1 || chatSendLog[0] !== $('#chat-text').val()) {
        chatSendLog.unshift($('#chat-text').val());
      }
      $('#chat-text').val('');
      chatSendIndex = -1;
    }
    else if(e.keyCode === 38) { // up
      e.preventDefault();
      chatSendIndex += 1;
      if(chatSendIndex >= chatSendLog.length) {
        chatSendIndex = chatSendLog.length - 1;
      }
      if(chatSendIndex !== -1) {
        $('#chat-text').val(chatSendLog[chatSendIndex]);
        $('#chat-text')[0].selectionStart = $('#chat-text')[0].selectionEnd = chatSendLog[chatSendIndex].length;
      }
    }
    else if(e.keyCode === 40) { // down
      e.preventDefault();
      chatSendIndex -= 1;
      if(chatSendIndex < -1) {
        chatSendIndex = -1;
      }
      if(chatSendIndex !== -1) {
        $('#chat-text').val(chatSendLog[chatSendIndex]);
        $('#chat-text')[0].selectionStart = $('#chat-text')[0].selectionEnd = chatSendLog[chatSendIndex].length;
      }
    }
  });

  $('#connect').keydown(function(e) {
    if(e.keyCode === 13) { // enter
      $('#connect-button').click();
    }
  });
  $('#login').keydown(function(e) {
    if(e.keyCode === 13) { // enter
      $('#login-button').click();
    }
  });
  $('#register').keydown(function(e) {
    if(e.keyCode === 13) { // enter
      $('#register-button').click();
    }
  });
  $('#seturl').keydown(function(e) {
    if(e.keyCode === 13) { // enter
      $('#seturl-button').click();
    }
  });
  $('#seturl-youtube').keydown(function(e) {
    if(e.keyCode === 13) { // enter
      $('#seturl-youtube-button').click();
    }
  });

  $('#connect-toggle').click(function() {
    if(!connected) {
      $('#connect').modal('show');
    }
    else {
      socket.disconnect();
      clientData.username = null;
      clientData.password = null;
      createSocket();
    }
  });

  $('#seturl-toggle').click(function() {
    if(connected) {
      $('#seturl').modal('show');
    }
  });

  $('#seturl-youtube-toggle').click(function() {
    if(connected) {
      $('#seturl-youtube').modal('show');
    }
  });

  $('#set-local').click(function() {
    if(mirroring) {
      $('#set-local').text('Set local mirror');
      mirroring = false;
      return;
    }

    if(connected && videoPlayer.src()) {
      ipc.send('localmirror-request');
    }
  });

  ipc.on('localmirror-response', function(event, result) {
    // TODO - local file server + local torrent server
    mirroring = true;
    videoPlayer.src(result);
    $('#set-local').text('Use server file');
  });

  $('#stop-video').click(function() {
    if(connected) {
      sendChat(['stop']);
    }
  });

  $('#restart-video').click(function() {
    if(connected) {
      sendChat(['start']);
    }
  });

  $('#seturl-button').click(function() {
    $('#seturl').modal('hide');
    sendChat(['seturl', $('#seturl-url').val()]);
  });
  $('#addtoqueue-button').click(function() {
    $('#seturl').modal('hide');
    sendChat(['queue', 'add', $('#seturl-url').val()]);
  });

  $('#seturl-youtube-button').click(function() {
    $('#seturl-youtube').modal('hide');
    sendChat(['seturl', 'ytdl://' + $('#seturl-youtube-url').val()]);
  });
  $('#addtoqueue-youtube-button').click(function() {
    $('#seturl-youtube').modal('hide');

    sendChat(['queue', 'add', 'ytdl://' + $('#seturl-youtube-url').val()]);
  });

  $('#close-app').click(function() {
    ipc.send('close');
  });

  var lastSize = {};
  var waitingRestore = false;

  lastSize.x = localStorage.lastSizeX;
  lastSize.y = localStorage.lastSizeY;
  lastSize.width = localStorage.lastSizeWidth;
  lastSize.height = localStorage.lastSizeHeight;

  $('#maximize-app').click(function() {
    ipc.send('maximize');
  });

  $('#minimize-app').click(function() {
    ipc.send('minimize');
  });

  // Load most recent settings
  if(localStorage.lastUser) {
    setTimeout(function() {
      clientData.username = localStorage.lastUser;
      $('#connect-user').val(localStorage.lastUser);

      $('#connect').modal('show');
      //requestSession();
    }, 0);
  }
  else {
    $('#connect').modal('show');
  }

  // Attempt to connect
  $('#connect-button').click(function() {
    setTimeout(function() {
      clientData.username = $('#connect-user').val();
      clientData.password = '';

      if(clientData.username === '') clientData.username = 'guest';
      else localStorage.lastUser = clientData.username;

      requestSession();
    }, 0);
  });

  $('#login-button').click(function() {
    setTimeout(function() {
      clientData.username = $('#login-user').val();
      clientData.password = $('#login-pass').val();

      if(clientData.username === '') clientData.username = 'guest';
      else localStorage.lastUser = clientData.username;

      requestSession();
    }, 0);
  });

  $('#register-button').click(function() {
    setTimeout(function() {
      if(!/^[a-zA-Z0-9_]{3,16}$/.test($('#register-user').val())) {
        $('#register-user').val('');
        showError('#register-user', '#register-error', 'Usernames must be from 3 to 16 characters long and can only contain numbers, letters, and underscores.', 5000);
        return;
      }

      if(!/^.{8,}$/.test($('#register-pass').val())) {
        $('#register-pass').val('');
        $('#register-pass-confirm').val('');
        showError('#register-pass', '#register-error', 'Passwords must be at least 8 characters long.', 3000);
        return;
      }

      if($('#register-pass').val() !== $('#register-pass-confirm').val()) {
        $('#register-pass-confirm').val('');
        showError('#register-pass-confirm', '#register-error', 'Passwords don\'t match.', 3000);
        return;
      }

      clientData.username = $('#register-user').val();
      clientData.password = $('#register-pass').val();

      requestSession(true);
    }, 0);
  });

  function showError(highlight, errorSelector, message, time) {
    var highlightEl = $(highlight);
    var errorEl = $(errorSelector);
    var label = $('span', highlightEl.parent());
    var original = label.css('color');
    label.css('color', 'red');
    label.animate({color: original}, time, null, function() {
      errorEl.css('display', 'none');
    });
    $('.panel-body', errorEl).text(message);
    errorEl.css('display', 'block');
  }

  $('#connect').on('shown.bs.modal', function() {
    $('#connect-user').focus();
  });
  $('#login').on('shown.bs.modal', function() {
    $('#login-pass').focus();
  });
  $('#register').on('shown.bs.modal', function() {
    $('#register-pass').focus();
  });

  function setConnected(c) {
    connected = c;

    if(connected) {
      $('#connect-toggle').text('Disconnect');
      $('#chat-text').prop('disabled', false);
      $('#seturl-toggle').prop('disabled', false);
    }
    else {
      $('#connect-toggle').text('Connect');
      $('#chat-text').prop('disabled', true);
      $('#seturl-toggle').prop('disabled', true);
    }
  }

  var videoPlayer = {
    player: document.getElementById('video-player'),

    src: function(url) {
      if(typeof url !== 'undefined') {
        if(url === null) url = '';
        this.player.src = url;
      }
      else {
        return this.player.src;
      }
    },

    pause: function() {
      this.player.pause();
    },

    paused: function() {
      return this.player.paused;
    },

    currentTime: function(time) {
      if(typeof time === 'number') {
        this.player.currentTime = time;
      }
      else {
        return this.player.currentTime;
      }
    },

    // TODO
    isFullscreen: function() {
      return this._fullscreen;
    },
    _fullscreen: false,

    volume: function(volume) {
      if(typeof volume === 'number') {
        this.player.volume = volume;
      }
      else {
        return this.player.volume;
      }
    },

    duration: function() {
      return this.player.duration;
    },

    play: function() {
      this.player.play();
    },

    ended: function() {
      return this.player.ended;
    }
  };

  setTimeout(function() {
    if(localStorage.lastVolume) {
      videoPlayer.volume(parseFloat(localStorage.lastVolume));
    }
    if(localStorage.lastPositiveVolume) {
      videoPlayerControls.lastPositiveVolume = parseFloat(localStorage.lastPositiveVolume);
    }
  }, 0);

  document.addEventListener('webkitfullscreenchange', function(e) {
    videoPlayer._fullscreen = !videoPlayer._fullscreen;
    adjustSizing();
  });

  var videoPlayerControls = {
    viewers: [],
    volumeWidth: 80,
    mouseOver: false,
    mouseOverViewers: false,
    visibility: Date.now(),
    visibilityTime: 2000,
    disappearTime: 500,
    buttonSize: 36,
    controls: document.getElementById('video-controls'),
    play: function() {
      if(videoPlayer.currentTime() === 0 || videoPlayer.currentTime() >= videoPlayer.duration()) {
        sendChat(['start']);
      }
      else {
        sendChat(['resume']);
      }
    },

    pause: function() {
      sendChat(['pause']);
    },

    volume: function(vol) {
      videoPlayer.volume(vol);
      localStorage.lastVolume = vol;

      if(vol > 0) {
        this.lastPositiveVolume = vol;
        localStorage.lastPositiveVolume = vol;
      }

      console.log(localStorage);
    },

    seek: function(time) {
      sendChat(['settime', (time * 1000)]);
    },

    fullscreen: function() {
      if(videoPlayer.isFullscreen()) {
        document.webkitExitFullscreen();
      }
      else {
        document.getElementById('video-container').webkitRequestFullscreen();
      }
    },

    draw: function() {
      var width = this.controls.clientWidth;
      var height = this.controls.clientHeight;
      var buttonSize = this.buttonSize;
      var ctx = this.controls.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      var opacity = 1;

      if(this.mouseOver !== 'none') this.visibility = Date.now();
      if(this.visibility + this.visibilityTime + this.disappearTime < Date.now()) {
        if(videoPlayer.isFullscreen()) {
          this.controls.style.cursor = 'none';
        }
        return;
      }
      if(this.visibility + this.visibilityTime < Date.now()) {
        opacity = 1 - ((Date.now() - this.visibility - this.visibilityTime) / this.disappearTime);
      }
      ctx.globalAlpha = opacity;

      var permissionsArr = clientData.permissions ? clientData.permissions : [];
      var permissions = {};
      permissionsArr.forEach(function(permission) {
        permissions[permission] = true;
      });

      // background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, height - buttonSize, width, buttonSize);

      // title
      if(clientData.lastPlayback && clientData.lastPlayback.videoInfo && clientData.lastPlayback.videoInfo.title) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, width, 20 + 24);
        ctx.fillStyle = 'white';
        ctx.font = '24px "Open Sans"';
        ctx.textBaseline = 'middle';
        ctx.fillText(clientData.lastPlayback.videoInfo.title, 10, 10 + 12);
      }

      if(videoPlayer.paused()) {
        ctx.drawImageScaled(this.image('play'), 0, height - buttonSize, buttonSize, buttonSize, 2);
      }
      else {
        ctx.drawImageScaled(this.image('pause'), 0, height - buttonSize, buttonSize, buttonSize, 4);
      }
      if(this.mouseOver === 'play' && !permissions.play) {
        ctx.drawImageScaled(this.image('disabled'), 0, height - buttonSize, buttonSize, buttonSize, 0);
      }

      // volume image
      var volumeImage = null;
      var volume = videoPlayer.volume();
      if(volume === 0) {
        volumeImage = this.image('volume0');
      }
      else if(volume < 0.5) {
        volumeImage = this.image('volume1');
      }
      else {
        volumeImage = this.image('volume2');
      }
      ctx.drawImageScaled(volumeImage, buttonSize, height - buttonSize, buttonSize, buttonSize, 8);

      // fullscreen image
      var fullscreenImage = videoPlayer.isFullscreen() ? this.image('fullscreen0') : this.image('fullscreen1');
      ctx.drawImageScaled(fullscreenImage, width - buttonSize, height - buttonSize, buttonSize, buttonSize, 5);

      // volume bar
      if(this.volumeOpen) {
        var midpoint = this.volumeWidth * volume;
        ctx.fillStyle = 'blue';
        ctx.fillRect(buttonSize * 2 + 5, height - (buttonSize / 2), midpoint, 2);
        ctx.fillStyle = 'white';
        ctx.fillRect(buttonSize * 2 + 5 + midpoint, height - (buttonSize / 2), this.volumeWidth - midpoint, 2);
        ctx.fillRect(buttonSize * 2 + 5 + midpoint - 2, height - (buttonSize / 2) - 5, 4, 12);
      }

      // seek bar
      var videoPercentage = videoPlayer.currentTime() / videoPlayer.duration();
      var seekHeight = 3;
      // background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, height - buttonSize - seekHeight, width, seekHeight);
      // buffered
      ctx.fillStyle = 'grey';
      for(var i = 0; i < videoPlayer.player.buffered.length; i++) {
        var start = videoPlayer.player.buffered.start(i) * width / videoPlayer.duration();
        var end = videoPlayer.player.buffered.end(i) * width / videoPlayer.duration();
        ctx.fillRect(start, height - buttonSize - seekHeight, end - start, seekHeight);
      }
      // current
      ctx.fillStyle = 'blue';
      ctx.fillRect(0, height - buttonSize - seekHeight, width * videoPercentage, seekHeight);
      // circle
      if(this.mouseOver === 'seek') {
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(width * videoPercentage, height - buttonSize - (seekHeight / 2), 4, 0, 2 * Math.PI);
        ctx.fill();
        if(!permissions.settime) {
          ctx.drawImageScaled(this.image('disabled'), width * videoPercentage - 15, height - buttonSize - (seekHeight / 2) - 15, 30, 30, 0);
        }
      }

      // current time / duration
      ctx.fillStyle = 'white';
      ctx.font = '12px "Open Sans"';
      ctx.textBaseline = 'middle';
      var time = videoPlayer.currentTime();
      var duration = videoPlayer.duration();
      if(isNaN(duration)) {
        ctx.fillText('- / -', this.volumeOpen ? buttonSize * 2 + 20 + this.volumeWidth : buttonSize * 2 + 5, height - (buttonSize / 2));
      }
      else {
        ctx.fillText(this.formatTime(time) + ' / ' + this.formatTime(duration), this.volumeOpen ? buttonSize * 2 + 20 + this.volumeWidth : buttonSize * 2 + 5, height - (buttonSize / 2));
      }

      // repeat image
      if(!clientData.lastPlayback || clientData.lastPlayback.loopMode === 'none') {
        ctx.drawImageScaled(this.image('repeat0'), width - buttonSize * 3, height - buttonSize, buttonSize, buttonSize, 7);
      }
      else if(clientData.lastPlayback.loopMode === 'one') {
        ctx.drawImageScaled(this.image('repeat1'), width - buttonSize * 3, height - buttonSize, buttonSize, buttonSize, 7);
      }
      else if(clientData.lastPlayback.loopMode === 'all') {
        ctx.drawImageScaled(this.image('repeat2'), width - buttonSize * 3, height - buttonSize, buttonSize, buttonSize, 7);
      }
      if(this.mouseOver === 'loop' && !permissions.loop) {
        ctx.drawImageScaled(this.image('disabled'), width - buttonSize * 3, height - buttonSize, buttonSize, buttonSize, 0);
      }

      // viewers image
      ctx.drawImageScaled(this.image('viewers'), width - buttonSize * 2, height - buttonSize, buttonSize, buttonSize, 7);

      // viewers panel
      if(this.mouseOver === 'viewers') {
        ctx.fillStyle = 'white';
        var initialX = width - buttonSize * 1.5;
        var initialY = height - buttonSize * 0.8;

        var viewers = this.viewers;
        var text = viewers.length === 1 ? '1 other viewer' : viewers.length + ' other viewers';
        ctx.font = '12px "Open Sans"';
        var metrics = ctx.measureText(text);
        ctx.font = '10px "Open Sans"';
        var boxWidth = metrics.width + 10;
        var boxHeight = 20;
        for(var i = 0; i < viewers.length; i++) {
          var metrics2 = ctx.measureText(viewers[i]);
          var width2 = metrics2.width + 10;
          var height2 = 10 + 3;
          boxHeight += height2;
          if(width2 > boxWidth) {
            boxWidth = width2;
          }
        }
        if(viewers.length > 0) {
          boxHeight += 2;
        }

        var leftCoord = initialX - (boxWidth / 2);
        var rightCoord = initialX + (boxWidth / 2);
        var boxMargin = 5;
        if(rightCoord > width - boxMargin) {
          leftCoord -= (rightCoord - width + boxMargin);
          rightCoord = width - boxMargin;
        }
        var triangleSize = 5;
        ctx.beginPath();
        ctx.moveTo(initialX, initialY);
        ctx.lineTo(initialX - triangleSize, initialY - triangleSize);
        ctx.lineTo(leftCoord, initialY - triangleSize);
        ctx.lineTo(leftCoord, initialY - triangleSize - boxHeight);
        ctx.lineTo(rightCoord, initialY - triangleSize - boxHeight);
        ctx.lineTo(rightCoord, initialY - triangleSize);
        ctx.lineTo(initialX + triangleSize, initialY - triangleSize);
        ctx.lineTo(initialX, initialY);
        ctx.fill();
        ctx.fillStyle = 'gray';
        ctx.font = '12px "Open Sans"';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, leftCoord + 5, initialY - triangleSize - boxHeight + 10);
        ctx.font = '10px "Open Sans"';
        for(var i = 0; i < viewers.length; i++) {
          ctx.fillText(viewers[i], leftCoord + 5, initialY - triangleSize - boxHeight + 10 + 15 + (13 * i));
        }
      }
    },

    formatTime: function(time) {
      var seconds = '' + Math.floor(time % 60);
      var minutes = '' + Math.floor(time / 60) % 60;
      var hours = '' + Math.floor(time / 3600);

      while(seconds.length < 2) {
        seconds = '0' + seconds;
      }
      while(minutes.length < 2) {
        minutes = '0' + minutes;
      }
      while(hours.length < 2) {
        hours = '0' + hours;
      }

      if(hours === '00') {
        return minutes + ':' + seconds;
      }

      return hours + ':' + minutes + ':' + seconds;
    },

    hitboxes: function(type) {
      var margin = 0;
      var width = this.controls.clientWidth;
      var height = this.controls.clientHeight;
      var seekMargin = 4;
      var volumeOpen = this.volumeOpen;
      var volumeWidth = this.volumeWidth;
      var buttonSize = this.buttonSize;
      var barTop = height - buttonSize + 4;

      var hitboxes = {
        seek: {
          minX: 0,
          minY: barTop - 4 - seekMargin,
          maxX: width,
          maxY: barTop
        },
        play: {
          minX: margin,
          minY: barTop + margin,
          maxX: buttonSize - margin,
          maxY: height - margin
        },
        volume: {
          minX: buttonSize + margin,
          minY: barTop + margin,
          maxX: buttonSize * 2 - margin,
          maxY: height - margin
        },
        volumeBar: {
          zeroX: buttonSize * 2 + 5,
          minX: buttonSize * 2 - margin,
          maxX: volumeOpen ? buttonSize * 2 + 5 + volumeWidth : 0,
          minY: barTop + margin,
          maxY: height - margin
        },
        loop: {
          minX: width - (buttonSize * 3) + margin,
          minY: barTop + margin,
          maxX: width - (buttonSize * 2) - margin,
          maxY: height - margin
        },
        viewers: {
          minX: width - (buttonSize * 2) + margin,
          minY: barTop + margin,
          maxX: width - buttonSize - margin,
          maxY: height - margin
        },
        fullscreen: {
          minX: width - buttonSize + margin,
          minY: barTop + margin,
          maxX: width - margin,
          maxY: height - margin
        },
      };

      if(type === 'hover') {
        hitboxes.volumeBar.minX -= 30;
        hitboxes.volumeBar.minY -= 20;
        hitboxes.volumeBar.maxX += 10;
        hitboxes.volumeBar.maxY += 20;
      }

      return hitboxes;
    },

    mouse: function(x, y, type) {
      var hitboxes = this.hitboxes(type);
      for(var region in hitboxes) {
        var hitbox = hitboxes[region];
        if(x >= hitbox.minX && y >= hitbox.minY && x < hitbox.maxX && y < hitbox.maxY) {
          return {
            region: region,
            relX: x - (typeof hitbox.zeroX === 'number' ? hitbox.zeroX : hitbox.minX),
            relY: y - (typeof hitbox.zeroY === 'number' ? hitbox.zeroY : hitbox.minY)
          };
        }
      }
      return {
        region: 'none',
        relX: x,
        relY: y
      };
    },

    region: function(x, y, type) {
      return this.mouse(x, y, type).region;
    },

    image: function(name) {
      var ref = '_image_' + name;
      if(!this[ref]) {
        this[ref] = new Image();
        this[ref].src = 'assets/player/' + name + '.svg';
      }
      return this[ref];
    }
  };
  // load all images
  videoPlayerControls.image('play');
  videoPlayerControls.image('pause');
  videoPlayerControls.image('volume0');
  videoPlayerControls.image('volume1');
  videoPlayerControls.image('volume2');
  videoPlayerControls.image('fullscreen0');
  videoPlayerControls.image('fullscreen1');
  videoPlayerControls.image('viewers');
  videoPlayerControls.image('repeat0');
  videoPlayerControls.image('repeat1');
  videoPlayerControls.image('repeat2');
  videoPlayerControls.image('disabled');
  CanvasRenderingContext2D.prototype.drawImageScaled = function(image, x, y, width, height, margin) {
    this.drawImage(image, x + margin, y + margin, width - (margin * 2), height - (margin * 2));
  };

  setInterval(function() { videoPlayerControls.draw(); }, 1000 / 30);

  // n:  play    seek    volume   fullscreen
  // x: [0-29] [30:-60] [-59:-30] [-29:-0]
  videoPlayerControls.controls.addEventListener('click', function(e) {
    var x = e.offsetX;
    var y = e.offsetY;
    var info = videoPlayerControls.mouse(x, y);
    var region = info.region;
    var height = videoPlayerControls.controls.clientHeight;
    var width = videoPlayerControls.controls.clientWidth;
    if(region === 'play') {
      if(!videoPlayer.paused()) {
        videoPlayerControls.pause();
      }
      else {
        videoPlayerControls.play();
      }
    }
    else if(region === 'seek') {
      var seekLocation = info.relX / width * videoPlayer.duration();
      videoPlayerControls.seek(seekLocation);
    }
    else if(region === 'volume') {
      if(videoPlayer.volume() === 0) {
        if(!videoPlayerControls.lastPositiveVolume) {
          videoPlayerControls.lastPositiveVolume = 0.5;
        }
        videoPlayerControls.volume(videoPlayerControls.lastPositiveVolume);
      }
      else {
        videoPlayerControls.volume(0);
      }
    }
    else if(region === 'volumeBar') {
      if(info.relX >= 0) {
        var volume = info.relX / videoPlayerControls.volumeWidth;
        videoPlayerControls.volume(volume);
      }
    }
    else if(region === 'loop') {
      if(clientData.lastPlayback) {
        if(clientData.lastPlayback.loopMode === 'none') {
          sendChat(['loop', 'one']);
        }
        else if(clientData.lastPlayback.loopMode === 'one') {
          sendChat(['loop', 'all']);
        }
        else if(clientData.lastPlayback.loopMode === 'all') {
          sendChat(['loop', 'none']);
        }
      }
    }
    else if(region === 'fullscreen') {
      videoPlayerControls.fullscreen();
    }
  }, true);

  videoPlayerControls.controls.addEventListener('mousemove', function(e) {
    var region = videoPlayerControls.region(e.offsetX, e.offsetY);
    if(region === 'play') {
      videoPlayerControls.controls.style.cursor = 'pointer';
    }
    else if(region === 'seek') {
      videoPlayerControls.controls.style.cursor = 'pointer';
    }
    else if(region === 'volume') {
      videoPlayerControls.controls.style.cursor = 'pointer';
    }
    else if(region === 'volumeBar') {
      videoPlayerControls.controls.style.cursor = 'pointer';
    }
    else if(region === 'loop') {
      videoPlayerControls.controls.style.cursor = 'pointer';
    }
    else if(region === 'fullscreen') {
      videoPlayerControls.controls.style.cursor = 'pointer';
    }
    else {
      videoPlayerControls.controls.style.cursor = 'default';
    }
    var hoverRegion = videoPlayerControls.region(e.offsetX, e.offsetY, 'hover');
    videoPlayerControls.volumeOpen = hoverRegion === 'volume' || hoverRegion === 'volumeBar';

    videoPlayerControls.visibility = Date.now();
    videoPlayerControls.mouseOver = region;
  });

  videoPlayerControls.controls.addEventListener('mouseleave', function(e) {
    videoPlayerControls.mouseOver = 'none';
  });

  adjustSizing();
  $(window).resize(adjustSizing);

  function adjustChatSizing() {
    var navHeight = $('#nav').height() + 1;
    if(videoPlayer.isFullscreen()) {
      navHeight = 0;
    }

    var messages = $('#chat-messages');
    $('#chat-messages-container').css('height', $('#chat-text').offset().top - navHeight - $('#queue-panel').height());

    updateChatScroll();
  }
  function adjustSizing() {
    $('#close-app').css('padding-right', '5px');
    $('#close-app').css('padding-left', '5px');
    $('#maximize-app').css('padding-right', '0px');
    $('#maximize-app').css('padding-left', '5px');
    $('#minimize-app').css('padding-right', '0px');
    $('#minimize-app').css('padding-left', '5px');
    $('#close-app-img').css('height', $('#app-title').height());
    $('#maximize-app-img').css('height', $('#app-title').height());
    $('#minimize-app-img').css('height', $('#app-title').height());

    var windowHeight = $(window).height();
    var windowWidth = $(window).width();

    var sidebar = $('#sidebar');
    var navHeight = $('#nav').height() + 1;
    if(videoPlayer.isFullscreen()) {
      navHeight = 0;
    }
    sidebar.css('position', 'fixed');
    sidebar.css('top', navHeight);
    sidebar.css('height', windowHeight - navHeight);
    sidebar.css('right', 0);
    var videoParent = $('#video-content');
    var videoContent = $('#video-player');
    var mainContentWidth = windowWidth - sidebar.outerWidth();
    videoContent.css('position', 'fixed');
    videoContent.css('left', 0);
    if(videoPlayer.isFullscreen()) {
      mainContentWidth = windowWidth;
      videoContent.css('top', 0);
    }
    else {
      videoContent.css('top', navHeight);
    }
    videoContent.css('height', windowHeight - navHeight);
    videoContent.css('width', mainContentWidth);
    $('#video-controls').attr('width', mainContentWidth);
    $('#video-controls').attr('height', windowHeight - navHeight);
    $('body').height(windowHeight);

    adjustChatSizing();
    renderQueue();
  }
};

function parseYoutube(body) {
  var ytBody = $.parseHTML(body, document, true);

  var script = null;
  var scripts = $('script', ytBody);

  for(var i = 0; i < scripts.length; i++) {
    var temp = scripts[i].innerHTML;

	  if(temp.indexOf('ytplayer.config = {') > -1) {
	    script = temp;
	    break;
    }
  }

  if(script === null) {
    console.log('PROBLEM - VIDEO UNAVAILABLE');
	  return null;
  }

  var startStr = 'ytplayer.config = {';
  var configStart = script.indexOf(startStr) + startStr.length;

  i = configStart;
  var depth = 1;

  while(depth > 0) {
    if(i >= script.length) {
	    console.log('PROBLEM - SCRIPT PARSING');
	    console.log(script);
	    process.exit();
	  }

	  var c = script.charAt(i);

	  if(c === '{') {
	    depth++;
	  }
	  else if(c === '}') {
	    depth--;
	  }

	  i++;
  }

  var configJson = JSON.parse('{' + script.substr(configStart, i - configStart - 1) + '}');

  var urls = configJson.args.url_encoded_fmt_stream_map.split(',');
  var urlObjects = [];

  for(var j = 0; j < urls.length; j++) {
    var urlParts = urls[j].split('&');
    var urlObject = {};
    urlObjects[j] = urlObject;
    for(i = 0; i < urlParts.length; i++) {
      var equalIndex = urlParts[i].indexOf('=');
      if(equalIndex !== -1) {
        urlObject[urlParts[i].substr(0, equalIndex)] = decodeURIComponent(urlParts[i].substr(equalIndex + 1));
      }
    }
  }

  console.log(urlObjects);

  var url = urlObjects[0].url;

  if(!url || url.substr(0, 4) !== 'http') {
    console.log('PROBLEM - URL PARSING');
	  console.log(urls);
    process.exit();
  }

  return {title: configJson.args.title, url: url};
}

function findString(startIndex, startStr, endStr, string) {
  var start = string.indexOf(startStr, startIndex) + startStr.length;
  if(start < 0 || start < startIndex) return null;
  var end = string.indexOf(endStr, start);
  if(end < 0 || end < startIndex) end = string.length;
  var part = string.substr(start, end - start);

  return {start: start, end: end, string: part};
}
