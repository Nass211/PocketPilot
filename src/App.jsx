import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Mic, ImagePlus, Paperclip, Camera } from 'lucide-react';

/* ─── Constants ─── */
const MODE_OPTIONS = [
  { value: 'ask', label: 'Ask', icon: '💬' },
  { value: 'plan', label: 'Plan', icon: '📋' },
  { value: 'agent', label: 'Agent', icon: '⚡' },
];

const MODEL_OPTIONS = [
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
];

const INITIAL_MESSAGES = [
  {
    id: 'welcome',
    role: 'assistant',
    text: "Bonjour ! Connectez le WebSocket pour commencer à piloter Copilot depuis votre téléphone.",
  },
];

const ATTACH_OPTIONS = [
  { key: 'audio',  label: 'Audio',   icon: Mic },
  { key: 'image',  label: 'Image',   icon: ImagePlus },
  { key: 'file',   label: 'Fichier', icon: Paperclip },
  { key: 'camera', label: 'Caméra',  icon: Camera },
];

/* ─── Main App ─── */
function App() {
  const wsUrl = useMemo(() => new URLSearchParams(window.location.search).get('ws'), []);
  const [connectionState, setConnectionState] = useState(wsUrl ? 'connecting' : 'missing');
  const [connectionMessage, setConnectionMessage] = useState(
    wsUrl ? 'Connexion en cours...' : "Ajoutez ?ws=ws://... dans l'URL"
  );
  const [mode, setMode] = useState('agent');
  const [model, setModel] = useState('claude-sonnet-4.6');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [editedFiles, setEditedFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [permissionRequest, setPermissionRequest] = useState(null);
  const [streamingMessageId, setStreamingMessageId] = useState(null);
  const [streamingEnded, setStreamingEnded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [codeText, setCodeText] = useState('');

  const toolsMenuRef = useRef(null);
  const textareaRef = useRef(null);
  const socketRef = useRef(null);
  const streamingMessageIdRef = useRef(null);
  const chatEndRef = useRef(null);
  const cancelAudioRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const excelInputRef = useRef(null);

  /* ─── WebSocket ─── */
  useEffect(() => {
    if (!wsUrl) return undefined;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    setConnectionState('connecting');
    setConnectionMessage(`Connexion à ${wsUrl}...`);

    socket.onopen = () => {
      setConnectionState('connected');
      setConnectionMessage('Connecté et prêt.');
    };

    socket.onmessage = (event) => {
      const payload = parseIncomingMessage(event.data);
      if (!payload) return;

      switch (payload.type) {
        case 'chunk':
          appendChunk(payload.text || '');
          break;
        case 'fileEdited':
          if (payload.filename) {
            setEditedFiles((current) => {
              const next = current.filter((f) => f.filename !== payload.filename);
              next.unshift({ filename: payload.filename, diff: Array.isArray(payload.diff) ? payload.diff : [] });
              return next;
            });
            setSelectedFile((current) => current || payload.filename);
          }
          break;
        case 'permissionRequest':
          setPermissionRequest(payload);
          break;
        case 'info':
          if (payload.text) pushSystemMessage(payload.text);
          break;
        case 'done':
          setStreamingEnded(true);
          setStreamingMessageId(null);
          streamingMessageIdRef.current = null;
          break;
        default:
          break;
      }
    };

    socket.onerror = () => {
      setConnectionState('error');
      setConnectionMessage("Erreur de socket.");
    };

    socket.onclose = () => {
      setConnectionState('closed');
      setConnectionMessage('Connexion fermée.');
      socketRef.current = null;
    };

    return () => socket.close();
  }, [wsUrl]);

  /* ─── Close menu on outside click ─── */
  useEffect(() => {
    function handleClickOutside(e) {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingMessageId, permissionRequest]);

  const isConnected = connectionState === 'connected';
  const currentModel = MODEL_OPTIONS.find((m) => m.value === model);

  /* ─── Core Handlers ─── */
  function emit(payload) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pushSystemMessage("WebSocket non connecté.");
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function pushSystemMessage(text) {
    setMessages((c) => [...c, { id: crypto.randomUUID(), role: 'system', text }]);
  }

  function appendChunk(text) {
    setStreamingEnded(false);
    setMessages((current) => {
      const next = [...current];
      let targetId = streamingMessageIdRef.current;
      if (!targetId) {
        targetId = crypto.randomUUID();
        streamingMessageIdRef.current = targetId;
        setStreamingMessageId(targetId);
        next.push({ id: targetId, role: 'assistant', text: '', streaming: true });
      }
      const index = next.findIndex((m) => m.id === targetId);
      if (index >= 0) {
        next[index] = { ...next[index], text: `${next[index].text || ''}${text}`, streaming: true };
      }
      return next;
    });
  }

  function handleModeChange(nextMode) {
    setMode(nextMode);
    emit({ type: 'setMode', mode: nextMode });
  }

  function handleModelChange(nextModel) {
    setModel(nextModel);
    setModelDropdownOpen(false);
    emit({ type: 'setModel', model: nextModel });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;

    if (!isConnected) {
      setMessages((c) => [
        ...c,
        { id: crypto.randomUUID(), role: 'user', text: trimmed },
        { id: crypto.randomUUID(), role: 'system', text: "WebSocket non connecté." },
      ]);
      setPrompt('');
      return;
    }

    const placeholderId = crypto.randomUUID();
    setMessages((c) => [
      ...c,
      { id: crypto.randomUUID(), role: 'user', text: trimmed },
      { id: placeholderId, role: 'assistant', text: '', streaming: true },
    ]);
    setStreamingMessageId(placeholderId);
    streamingMessageIdRef.current = placeholderId;
    setStreamingEnded(false);
    setPrompt('');
    emit({ type: 'prompt', text: trimmed });
  }

  function handlePermissionResponse(allowed) {
    if (!permissionRequest) return;
    emit({ type: 'permissionResponse', allowed });
    pushSystemMessage(`${allowed ? '✓ Autorisé' : '✕ Refusé'}: ${permissionRequest.command}`);
    setPermissionRequest(null);
  }

  /* ─── Changes Control ─── */
  function handleAcceptAllChanges() {
    emit({ type: 'acceptAllChanges', files: editedFiles.map((f) => f.filename) });
    pushSystemMessage(`✅ ${editedFiles.length} fichier(s) accepté(s) : ${editedFiles.map((f) => f.filename).join(', ')}`);
    setEditedFiles([]);
    setSelectedFile('');
  }

  function handleUndoChanges() {
    emit({ type: 'undoChanges', files: editedFiles.map((f) => f.filename) });
    pushSystemMessage(`↩️ Modifications annulées pour : ${editedFiles.map((f) => f.filename).join(', ')}`);
    setEditedFiles([]);
    setSelectedFile('');
  }

  /* ─── Attachment Handlers ─── */
  function sendAttachmentToCopilot(type, name, data) {
    setMessages((c) => [
      ...c,
      { id: crypto.randomUUID(), role: 'user', text: `📎 [${type}] ${name}` },
    ]);
    const placeholderId = crypto.randomUUID();
    setMessages((c) => [
      ...c,
      { id: placeholderId, role: 'assistant', text: '', streaming: true },
    ]);
    setStreamingMessageId(placeholderId);
    streamingMessageIdRef.current = placeholderId;
    setStreamingEnded(false);
    emit({ type: 'attachment', attachmentType: type, filename: name, data });
  }

  function readFileAsBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  const handleFileInput = useCallback(async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setAttachMenuOpen(false);
    pushSystemMessage(`⏳ Envoi de ${file.name}...`);
    const base64 = await readFileAsBase64(file);
    sendAttachmentToCopilot(type, file.name, base64);
  }, []);

  function handleAudioRecord() {
    setAttachMenuOpen(false);
    if (isRecording) return; // Prevent double starting
    
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        audioChunksRef.current = [];
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (cancelAudioRef.current) {
            cancelAudioRef.current = false;
            pushSystemMessage('🚫 Enregistrement annulé.');
            return;
          }
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = () => {
            sendAttachmentToCopilot('audio', `audio_${Date.now()}.webm`, reader.result);
          };
          reader.readAsDataURL(blob);
          pushSystemMessage('🎤 Enregistrement terminé, envoi en cours...');
        };
        recorder.start();
        setIsRecording(true);
        cancelAudioRef.current = false;
        pushSystemMessage('🔴 Enregistrement audio en cours...');
      })
      .catch(() => {
        pushSystemMessage('⚠️ Impossible d\'accéder au microphone. Vérifiez les permissions.');
      });
  }

  function handleCancelAudio() {
    cancelAudioRef.current = true;
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  function handleSendAudio() {
    cancelAudioRef.current = false;
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  function handleCodePaste() {
    setAttachMenuOpen(false);
    setCodeText('');
    setCodeModalOpen(true);
  }

  function handleCodeModalSend() {
    if (!codeText.trim()) {
      pushSystemMessage('⚠️ Aucun code à envoyer.');
      setCodeModalOpen(false);
      return;
    }
    setCodeModalOpen(false);
    sendAttachmentToCopilot('code', 'clipboard_code.txt', codeText);
    setCodeText('');
  }

  function handleUrlShare() {
    setAttachMenuOpen(false);
    const url = window.prompt('🌐 Entrez l\'URL à partager :');
    if (url && url.trim()) {
      sendAttachmentToCopilot('url', url.trim(), url.trim());
    }
  }

  function handleAttachOption(key) {
    switch (key) {
      case 'audio':  handleAudioRecord(); break;
      case 'image':  setAttachMenuOpen(false); imageInputRef.current?.click(); break;
      case 'file':   setAttachMenuOpen(false); fileInputRef.current?.click(); break;
      case 'camera': setAttachMenuOpen(false); cameraInputRef.current?.click(); break;
      case 'excel':  setAttachMenuOpen(false); excelInputRef.current?.click(); break;
      case 'code':   handleCodePaste(); break;
      case 'url':    handleUrlShare(); break;
      default: break;
    }
  }

  /* ─── Render ─── */
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      {/* Hidden file inputs */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileInput(e, 'image')} />
      <input ref={fileInputRef} type="file" accept="*/*" className="hidden" onChange={(e) => handleFileInput(e, 'file')} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFileInput(e, 'camera')} />
      <input ref={excelInputRef} type="file" accept=".xlsx,.xls,.csv,.ods" className="hidden" onChange={(e) => handleFileInput(e, 'excel')} />

      {/* ─── Sidebar ─── */}
      <aside
        className={`flex flex-col border-r border-border bg-bg-sidebar transition-all duration-300 ${
          sidebarOpen ? 'w-[260px]' : 'w-0 overflow-hidden border-r-0'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-3 px-4 pt-5 pb-4">
            <svg className="w-8 h-8 shrink-0" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
              <rect width="120" height="120" rx="26" fill="#1C1208"/>
              <rect width="120" height="120" rx="26" fill="#2a1a08" opacity="0.5"/>
              <polygon points="60,22 32,82 60,68" fill="#C1440E"/>
              <polygon points="60,22 88,82 60,68" fill="#7A2A06"/>
              <polygon points="32,82 60,68 88,82 60,90" fill="#4a1a04"/>
            </svg>
            <span className="text-text font-semibold text-[15px] tracking-tight">PocketPilot</span>
          </div>

          {/* New Chat Button */}
          <div className="px-3 mb-4">
            <button
              type="button"
              onClick={() => {
                setMessages(INITIAL_MESSAGES);
                setEditedFiles([]);
                setSelectedFile('');
                setPermissionRequest(null);
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-bg-card px-3 py-2.5 text-sm text-text hover:border-accent/50 hover:bg-accent/10 transition-theme"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Nouveau chat
            </button>
          </div>

          {/* Mode Selector */}
          <div className="px-4 mb-4">
            <div className="text-[11px] uppercase tracking-[0.15em] text-text-muted mb-2 font-medium">Mode</div>
            <div className="space-y-1">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleModeChange(option.value)}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-theme ${
                    mode === option.value
                      ? 'bg-accent/15 text-accent-text font-medium'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text'
                  }`}
                >
                  <span className="text-[13px]">{option.icon}</span>
                  <span>{option.label}</span>
                  {mode === option.value && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Model Selector */}
          <div className="px-4 mb-4">
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="w-full flex items-center justify-between rounded-xl border border-border bg-bg-card px-3 py-2.5 text-sm text-text hover:border-border-focus transition-theme"
              >
                <span className="truncate">{currentModel?.label || model}</span>
                <svg className={`w-4 h-4 text-text-muted transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              {modelDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 rounded-xl border border-border bg-bg-card shadow-2xl z-50 overflow-hidden animate-fade-in">
                  {MODEL_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleModelChange(option.value)}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-theme ${
                        model === option.value
                          ? 'bg-accent/15 text-accent-text'
                          : 'text-text-secondary hover:bg-bg-hover hover:text-text'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Edited Files */}
          {editedFiles.length > 0 && (
            <div className="px-4 mb-4 flex-1 min-h-0 overflow-hidden">
              <div className="text-[11px] uppercase tracking-[0.15em] text-text-muted mb-2 font-medium">Fichiers modifiés</div>
              <div className="space-y-0.5 overflow-y-auto max-h-40">
                {editedFiles.map((file) => (
                  <button
                    key={file.filename}
                    type="button"
                    onClick={() => setSelectedFile(file.filename)}
                    className={`w-full text-left rounded-lg px-3 py-1.5 text-[13px] font-mono transition-theme truncate ${
                      selectedFile === file.filename
                        ? 'bg-success/15 text-success-text'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text'
                    }`}
                  >
                    <span className="mr-2 text-success">●</span>
                    {file.filename}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Connection Status */}
          <div className="mt-auto px-4 pb-4">
            <ConnectionBadge state={connectionState} />
          </div>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3 bg-bg shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-lg p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text transition-theme"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
            <h1 className="text-[15px] font-medium text-text">
              {currentModel?.label || model} <span className="text-text-muted text-xs ml-1">·</span>{' '}
              <span className="text-text-muted text-xs">{mode}</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill streaming={!!streamingMessageId} ended={streamingEnded} />
            {isRecording && (
              <div className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-red-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse-dot" />
                REC
              </div>
            )}
          </div>
        </header>

        {/* Changes Action Bar */}
        {editedFiles.length > 0 && (
          <div className="shrink-0 border-b border-border bg-bg-card/80 backdrop-blur-sm px-4 py-2.5 animate-slide-up">
            <div className="mx-auto max-w-3xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-success/15 shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-success"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                </div>
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-text">{editedFiles.length} fichier{editedFiles.length > 1 ? 's' : ''} modifié{editedFiles.length > 1 ? 's' : ''}</span>
                  <span className="text-[11px] text-text-muted ml-2 hidden sm:inline truncate">{editedFiles.map(f => f.filename).join(', ')}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleUndoChanges}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:bg-danger/10 hover:border-danger/30 hover:text-danger transition-theme"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                  Undo
                </button>
                <button
                  type="button"
                  onClick={handleAcceptAllChanges}
                  className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-[12px] font-semibold text-text-inverse hover:bg-success-hover transition-theme"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  Accept all
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 space-y-1">
            {messages.map((message) => (
              <ChatBubble key={message.id} message={message} />
            ))}

            {/* Permission Request Card */}
            {permissionRequest && (
              <div className="animate-slide-up my-4">
                <div className="rounded-xl border border-warning/30 bg-warning-muted p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-warning text-sm">⚠</span>
                    <span className="text-[11px] uppercase tracking-[0.15em] text-warning-text font-medium">Permission requise</span>
                  </div>
                  <div className="rounded-lg bg-bg/50 border border-border px-3 py-2 font-mono text-sm text-warning-text mb-4">
                    {permissionRequest.command}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handlePermissionResponse(true)}
                      className="flex-1 rounded-lg bg-success px-4 py-2.5 text-sm font-semibold text-text-inverse hover:bg-success-hover transition-theme flex items-center justify-center gap-2"
                    >
                      <span>✓</span> Autoriser
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePermissionResponse(false)}
                      className="flex-1 rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-text-inverse hover:bg-danger-hover transition-theme flex items-center justify-center gap-2"
                    >
                      <span>✕</span> Refuser
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-border px-4 py-3 bg-bg shrink-0">
          <form onSubmit={(e) => { e.preventDefault(); if (!isRecording) handleSubmit(e); }} className="mx-auto max-w-3xl">
            {isRecording ? (
              <div className="flex w-full items-center gap-3 p-1.5 bg-[#121212] rounded-[32px] border border-[#2c2c2e]">
                <button
                  type="button"
                  onClick={handleCancelAudio}
                  className="flex shrink-0 h-[38px] w-[38px] items-center justify-center rounded-full bg-[#2c2c2e] hover:bg-[#3a3a3c] transition-colors"
                >
                  <div className="w-3.5 h-3.5 rounded-[3px] bg-white"></div>
                </button>
                <div className="flex-1 flex items-center h-[38px] px-3 rounded-full bg-[#1c1c1e] border border-[#2c2c2e] overflow-hidden">
                  <div className="flex items-center justify-start gap-[2px] h-4 w-full opacity-60">
                    {Array.from({ length: 45 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-[2.5px] bg-white rounded-full animate-soundwave"
                        style={{
                          height: `${Math.max(4, Math.random() * 16)}px`,
                          animationDelay: `${i * 0.04}s`,
                          animationDuration: `${0.6 + Math.random() * 0.4}s`
                        }}
                      ></div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSendAudio}
                  className="flex shrink-0 h-[38px] w-[38px] items-center justify-center rounded-full bg-white hover:bg-gray-200 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                </button>
              </div>
            ) : (
              <div className="relative flex items-end gap-2 rounded-xl border border-border bg-bg-card p-2 focus-within:border-accent/50 transition-theme">
                {/* Attach "+" Button */}
                <div className="relative" ref={toolsMenuRef}>
                  <button
                    type="button"
                    onClick={() => setAttachMenuOpen(!attachMenuOpen)}
                    className={`rounded-[10px] p-2.5 transition-all duration-300 ${
                      attachMenuOpen
                        ? 'bg-accent/15 text-accent rotate-45'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text rotate-0'
                    }`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>

                  {/* iOS-style Attachment Menu */}
                  {attachMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setAttachMenuOpen(false)} />
                      <div className="absolute bottom-full left-0 mb-3 z-50 animate-slide-up origin-bottom-left">
                        <div className="rounded-[20px] bg-[#222224] w-[220px] flex flex-col overflow-hidden shadow-2xl border border-[#333336]">
                          {ATTACH_OPTIONS.map((opt, i) => {
                            const Icon = opt.icon;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => handleAttachOption(opt.key)}
                                className={`flex justify-between items-center px-4 py-3.5 transition-colors hover:bg-[#2a1a08] active:bg-[#3a2412] group ${
                                  i !== ATTACH_OPTIONS.length - 1 ? 'border-b border-[#333336]' : ''
                                }`}
                              >
                                <span className="text-[16px] text-[#f4f4f5] tracking-tight">{opt.label}</span>
                                <Icon className="w-5 h-5 text-[#f4f4f5]" strokeWidth={1.75} />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  rows={1}
                  placeholder={isConnected ? 'Envoyer un prompt à Copilot...' : 'Connectez le WebSocket pour chatter'}
                  className="max-h-36 flex-1 resize-none border-0 bg-transparent px-3 py-[9px] text-sm text-text outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
                />
                <div className="flex items-center gap-1.5 pb-0.5">
                  <button
                    type="submit"
                    disabled={!prompt.trim()}
                    className="rounded-full bg-white w-8 h-8 flex items-center justify-center text-black hover:bg-gray-200 transition-theme disabled:cursor-not-allowed disabled:bg-border disabled:text-text-muted"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </main>

      {/* ─── Code Paste Modal ─── */}
      {codeModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCodeModalOpen(false)} />
          <div className="relative w-full max-w-lg mx-4 mb-4 sm:mb-0 rounded-2xl border border-border bg-bg-card shadow-2xl shadow-black/60 animate-slide-up overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <span className="text-xl">📋</span>
                <div>
                  <h2 className="text-sm font-semibold text-text">Coller du code</h2>
                  <p className="text-[11px] text-text-muted mt-0.5">Collez votre code ci-dessous puis envoyez</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCodeModalOpen(false)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-bg-hover hover:text-text transition-theme"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            {/* Textarea */}
            <div className="p-4">
              <textarea
                autoFocus
                value={codeText}
                onChange={(e) => setCodeText(e.target.value)}
                placeholder="Appuyez longuement ici pour coller votre code..."
                className="w-full min-h-[200px] max-h-[50vh] resize-y rounded-xl border border-border bg-bg/80 px-4 py-3 text-sm text-text font-mono outline-none placeholder:text-text-muted focus:border-accent/50 transition-theme"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 px-4 pb-4">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text) setCodeText((prev) => prev + text);
                  } catch {
                    pushSystemMessage('⚠️ Presse-papier inaccessible. Collez manuellement.');
                  }
                }}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-border bg-bg-hover px-4 py-3 text-sm text-text-secondary hover:bg-bg-card hover:text-text transition-theme"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                Coller
              </button>
              <button
                type="button"
                onClick={handleCodeModalSend}
                disabled={!codeText.trim()}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-text-inverse hover:bg-accent-hover disabled:bg-border disabled:text-text-muted disabled:cursor-not-allowed transition-theme"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                Envoyer à Copilot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Connection Badge ─── */
function ConnectionBadge({ state }) {
  const config = {
    connected: { color: 'bg-success', label: 'Connecté', textColor: 'text-success-text' },
    connecting: { color: 'bg-warning', label: 'Connexion...', textColor: 'text-warning-text' },
    error: { color: 'bg-danger', label: 'Erreur', textColor: 'text-danger' },
    closed: { color: 'bg-danger', label: 'Déconnecté', textColor: 'text-danger' },
    missing: { color: 'bg-text-muted', label: 'Non configuré', textColor: 'text-text-muted' },
  };

  const c = config[state] || config.missing;

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-bg-card border border-border">
      <span className={`h-2 w-2 rounded-full ${c.color} ${state === 'connected' ? 'animate-pulse-dot' : ''}`} />
      <span className={`text-[13px] ${c.textColor}`}>{c.label}</span>
    </div>
  );
}

/* ─── Status Pill ─── */
function StatusPill({ streaming, ended }) {
  if (streaming) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-accent-text font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
        Streaming
      </div>
    );
  }
  if (ended) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-success-text font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Terminé
      </div>
    );
  }
  return null;
}

/* ─── Chat Bubble ─── */
function ChatBubble({ message }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={`flex w-full animate-fade-in ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`flex gap-3 max-w-[85%] ${isUser ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        {!isSystem && (
          <div className={`flex-shrink-0 mt-1 h-7 w-7 rounded-lg flex items-center justify-center text-[11px] font-bold ${
            isUser
              ? 'bg-accent/20 text-accent'
              : 'bg-success/20 text-success'
          }`}>
            {isUser ? 'W' : 'AI'}
          </div>
        )}

        {/* Message */}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-accent/15 text-text border border-accent/20'
              : isSystem
                ? 'bg-bg-card/50 text-text-secondary border border-border/50 text-[13px] italic'
                : 'bg-bg-card text-text border border-border'
          }`}
        >
          <div className="whitespace-pre-wrap break-words">
            {message.text || (
              <span className="text-text-muted">
                <span className="inline-block typing-cursor" />
              </span>
            )}
          </div>
          {message.streaming && message.text && (
            <span className="inline-block typing-cursor" />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Utilities ─── */
function parseIncomingMessage(raw) {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default App;