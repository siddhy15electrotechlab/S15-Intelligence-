import React, { useState, useEffect, useRef } from 'react';
import { createChatSession, extractSourcesFromResponse, fileToPart, generateImageContent } from './services/geminiService';
import { Message, ModelMode, Source, User, Attachment, ChatSession } from './types';
import { MessageItem } from './components/MessageItem';
import { InputArea } from './components/InputArea';
import { Sidebar } from './components/Sidebar';
import { Chat, GenerateContentResponse } from '@google/genai';
import { Sparkles, Trash2, Phone, X, Mic, Menu, Mail, LogIn, ArrowRight, UserPlus, User as UserIcon, Settings, Volume2, ChevronDown, AlertCircle, Shield, Lock, Camera, CheckCircle, Keyboard, Sliders } from 'lucide-react';

const App: React.FC = () => {
  // Login State
  const [user, setUser] = useState<User | null>(null);
  const [showLogin, setShowLogin] = useState(true);
  const [isSignUp, setIsSignUp] = useState(false);
  const [authName, setAuthName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Permissions State
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // App State
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<ModelMode>(ModelMode.FAST_SEARCH);
  const [sessionId, setSessionId] = useState<string>(Date.now().toString());
  
  // History State
  const [showSidebar, setShowSidebar] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  // Voice Call State
  const [isCallActive, setIsCallActive] = useState(false);
  const [callStatus, setCallStatus] = useState<'listening' | 'speaking' | 'connecting' | 'error'>('connecting');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Voice Style State - Persisted
  const [voicePitch, setVoicePitch] = useState(() => parseFloat(localStorage.getItem('s15_voice_pitch') || '1.0'));
  const [voiceRate, setVoiceRate] = useState(() => parseFloat(localStorage.getItem('s15_voice_rate') || '1.0'));
  
  // Voice Security - Persisted
  const [voiceSecurityKey, setVoiceSecurityKey] = useState(() => localStorage.getItem('s15_voice_security_key') || '');
  
  // Refs
  const chatSessionRef = useRef<Chat | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false); 
  const callActiveRef = useRef(false);

  // Check for active session & permissions
  useEffect(() => {
    const activeUser = localStorage.getItem('s15_active_user');
    if (activeUser) {
      try {
        const parsedUser = JSON.parse(activeUser);
        setUser(parsedUser);
        setShowLogin(false);
        loadUserSessions(parsedUser.email);
        
        // Check local storage for permission flag or text-only preference
        const savedPerms = localStorage.getItem('s15_permissions_granted');
        const textOnlyMode = localStorage.getItem('s15_text_only_mode');

        if (savedPerms === 'true' || textOnlyMode === 'true') {
            setPermissionsGranted(true);
        } else {
            // Check if previously authorized via browser API
            checkPermissionsSilent();
        }
      } catch (e) {
        console.error("Failed to parse active user", e);
      }
    }
  }, []);

  // Load Voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      
      // Try to load saved voice preference or default
      const savedVoiceURI = localStorage.getItem('s15_selected_voice_uri');
      
      if (savedVoiceURI && voices.some(v => v.voiceURI === savedVoiceURI)) {
          setSelectedVoiceURI(savedVoiceURI);
      } else if (!selectedVoiceURI && voices.length > 0) {
        const preferred = voices.find(v => v.name.includes('Google US English')) || 
                          voices.find(v => v.lang === 'en-US') || 
                          voices[0];
        setSelectedVoiceURI(preferred.voiceURI);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [selectedVoiceURI]);

  // Load history for specific user
  const loadUserSessions = (userEmail: string) => {
    const saved = localStorage.getItem(`s15_sessions_${userEmail}`);
    if (saved) {
      try {
        setSessions(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load sessions", e);
      }
    } else {
      setSessions([]);
    }
  };

  // Save history on updates
  useEffect(() => {
    if (user && sessions.length > 0) {
      localStorage.setItem(`s15_sessions_${user.email}`, JSON.stringify(sessions));
    }
  }, [sessions, user]);

  // Update current session in history when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setSessions(prev => {
        const existing = prev.find(s => s.id === sessionId);
        const newSession: ChatSession = {
          id: sessionId,
          title: existing?.title || messages[0].text.substring(0, 40) || 'New Conversation',
          date: Date.now(),
          messages: messages,
          mode: mode
        };
        
        if (existing) {
          return prev.map(s => s.id === sessionId ? newSession : s);
        } else {
          return [...prev, newSession];
        }
      });
    }
    scrollToBottom();
  }, [messages, sessionId, mode]);

  // Initialize chat
  useEffect(() => {
    if (user) {
      initChat(mode);
    }
  }, [user]);

  const initChat = (selectedMode: ModelMode) => {
    try {
      if (selectedMode !== ModelMode.IMAGE_GEN && user) {
        chatSessionRef.current = createChatSession(selectedMode, user.name);
      }
    } catch (e) {
      console.error("Failed to init chat", e);
    }
  };

  const handleModeChange = (newMode: ModelMode) => {
    if (newMode === mode) return;
    if (navigator.vibrate) navigator.vibrate(10);
    setMode(newMode);
    initChat(newMode);
  };

  const handleNewChat = () => {
    if (navigator.vibrate) navigator.vibrate(15);
    const newId = Date.now().toString();
    setSessionId(newId);
    setMessages([]);
    setMode(ModelMode.FAST_SEARCH);
    initChat(ModelMode.FAST_SEARCH);
  };

  const handleSelectSession = (session: ChatSession) => {
    setSessionId(session.id);
    setMessages(session.messages);
    setMode(session.mode);
    initChat(session.mode);
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (sessionId === id) {
      handleNewChat();
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('s15_active_user');
    setUser(null);
    setShowLogin(true);
    // Don't revoke permissions on logout, but reset state for safety
    setPermissionsGranted(false);
    setSessions([]);
    setMessages([]);
    setEmail('');
    setPassword('');
    setAuthName('');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // --- PERMISSIONS HANDLING ---

  const checkPermissionsSilent = async () => {
    try {
        // Some browsers don't support this query
        if (navigator.permissions && navigator.permissions.query) {
            const permissions = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            if (permissions.state === 'granted') {
                setPermissionsGranted(true);
                localStorage.setItem('s15_permissions_granted', 'true');
            }
        }
    } catch (e) {
        console.log("Permission query not supported");
    }
  };

  const requestMediaPermissions = async () => {
    setPermissionError(null);
    
    // Check if browser supports media devices
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionError("This browser does not support voice features.");
        return;
    }

    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setPermissionsGranted(true);
        localStorage.setItem('s15_permissions_granted', 'true');
        // Clear any text-only preference if they successfully granted permission
        localStorage.removeItem('s15_text_only_mode');
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } catch (e: any) {
        console.error("Permission request failed", e);
        let errorMsg = "Microphone access failed.";
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
             errorMsg = "Access denied. Please enable microphone in your browser settings.";
        } else if (e.name === 'NotFoundError') {
             errorMsg = "No microphone found on this device.";
        }
        setPermissionError(errorMsg);
    }
  };

  const handleTextOnlyMode = () => {
      setPermissionsGranted(true);
      localStorage.setItem('s15_text_only_mode', 'true');
  };


  // --- AUTH HANDLERS ---
  
  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (!email || !password) {
      setAuthError("Please fill in all fields");
      return;
    }

    if (isSignUp) {
      if (!authName) {
        setAuthError("Name is required");
        return;
      }
      const existingUsersStr = localStorage.getItem('s15_users');
      const existingUsers = existingUsersStr ? JSON.parse(existingUsersStr) : {};
      if (existingUsers[email]) {
        setAuthError("User already exists. Please login.");
        return;
      }
      const newUser = { name: authName, email, password, avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${authName}` };
      existingUsers[email] = newUser;
      localStorage.setItem('s15_users', JSON.stringify(existingUsers));
      const userData: User = { name: newUser.name, email: newUser.email, avatarUrl: newUser.avatarUrl };
      loginUser(userData);
    } else {
      const existingUsersStr = localStorage.getItem('s15_users');
      const existingUsers = existingUsersStr ? JSON.parse(existingUsersStr) : {};
      const foundUser = existingUsers[email];
      if (foundUser && foundUser.password === password) {
         const userData: User = { name: foundUser.name, email: foundUser.email, avatarUrl: foundUser.avatarUrl };
         loginUser(userData);
      } else {
        setAuthError("Invalid credentials");
      }
    }
  };

  const handleGoogleLogin = () => {
    const googleUser: User = {
      name: "Siddharth",
      email: "siddharth@gmail.com",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Siddharth"
    };
    loginUser(googleUser);
  };

  const loginUser = (userData: User) => {
    if (navigator.vibrate) navigator.vibrate([50, 50]);
    localStorage.setItem('s15_active_user', JSON.stringify(userData));
    setUser(userData);
    setShowLogin(false);
    loadUserSessions(userData.email);
    
    // Check permissions immediately after login if not already done
    const savedPerms = localStorage.getItem('s15_permissions_granted');
    const textOnly = localStorage.getItem('s15_text_only_mode');
    
    if (savedPerms === 'true' || textOnly === 'true') {
        setPermissionsGranted(true);
    }
  };


  // --- CHAT LOGIC ---

  const handleSendMessage = async (text: string, attachments: Attachment[] = []) => {
    if (navigator.vibrate) navigator.vibrate(10);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text,
      attachments
    };

    const aiMessageId = (Date.now() + 1).toString();
    const initialAiMessage: Message = {
      id: aiMessageId,
      role: 'model',
      text: '',
      isThinking: true,
      sources: []
    };

    setMessages(prev => [...prev, userMessage, initialAiMessage]);
    setIsLoading(true);

    try {
      if (mode === ModelMode.IMAGE_GEN) {
        const imageBase64 = await generateImageContent(text);
        setMessages(prev => prev.map(msg => {
          if (msg.id === aiMessageId) {
            return {
              ...msg,
              text: imageBase64 ? "Here is the image you requested." : "I couldn't generate an image for that prompt.",
              generatedImage: imageBase64 || undefined,
              isThinking: false
            };
          }
          return msg;
        }));
        setIsLoading(false);
        return;
      }

      if (!chatSessionRef.current) initChat(mode);
      
      let messageContent: any = text;
      
      if (attachments.length > 0) {
        const parts = [];
        if (text) parts.push({ text });
        for (const att of attachments) {
          const part = await fileToPart(att.file);
          parts.push(part);
        }
        messageContent = parts;
      }

      const result = await chatSessionRef.current!.sendMessageStream({ message: messageContent });
      
      let fullText = '';
      let accumulatedSources: Source[] = [];

      for await (const chunk of result) {
        const responseChunk = chunk as GenerateContentResponse;
        const textChunk = responseChunk.text;
        if (textChunk) fullText += textChunk;
        const sources = extractSourcesFromResponse(responseChunk);
        if (sources.length > 0) accumulatedSources = [...accumulatedSources, ...sources];

        setMessages(prev => prev.map(msg => {
          if (msg.id === aiMessageId) {
            return {
              ...msg,
              text: fullText,
              isThinking: false,
              sources: accumulatedSources
            };
          }
          return msg;
        }));
      }

    } catch (error) {
      console.error("Error sending message:", error);
      setMessages(prev => prev.map(msg => {
        if (msg.id === aiMessageId) {
          return {
            ...msg,
            text: "I encountered an error. Please check your connection.",
            isThinking: false
          };
        }
        return msg;
      }));
    } finally {
      setIsLoading(false);
    }
  };


  // --- VOICE CALL LOGIC ---

  const startVoiceCall = () => {
    // If user explicitly chose text-only mode before, warn them
    if (localStorage.getItem('s15_text_only_mode') === 'true') {
        const confirmSwitch = window.confirm("You are in Text Only mode. Enable microphone to use voice call?");
        if (!confirmSwitch) return;
        localStorage.removeItem('s15_text_only_mode'); // Clear flag to allow retry
    }

    if (synthRef.current) {
        synthRef.current.cancel();
        const silent = new SpeechSynthesisUtterance(" ");
        synthRef.current.speak(silent);
    }
    setIsCallActive(true);
    callActiveRef.current = true;
    setCallStatus('connecting');
    setErrorMessage('');
    isProcessingRef.current = false;
    
    if (mode === ModelMode.IMAGE_GEN) {
        setMode(ModelMode.FAST_SEARCH);
        initChat(ModelMode.FAST_SEARCH);
    }
    // Immediate execution for permissions
    startListening();
  };

  const endVoiceCall = () => {
    setIsCallActive(false);
    callActiveRef.current = false;
    isProcessingRef.current = false;
    setShowVoiceSettings(false);
    if (synthRef.current) synthRef.current.cancel();
    if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
    }
  };

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
       setCallStatus('error');
       setErrorMessage("Voice API not supported.");
       return;
    }

    if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.lang = 'en-US';
    recognitionRef.current.interimResults = false;

    recognitionRef.current.onstart = () => {
        if (callActiveRef.current) {
            setCallStatus('listening');
            setErrorMessage('');
        }
    };

    recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript && callActiveRef.current) {
            processVoiceInput(transcript);
        }
    };

    recognitionRef.current.onerror = (e: any) => {
        console.log("Voice error", e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            setCallStatus('error');
            setErrorMessage("Access Denied. Check permissions.");
            return;
        }
        if (e.error === 'no-speech') {
             if (callActiveRef.current && !isProcessingRef.current) {
                try { recognitionRef.current?.start(); } catch (err) {}
             }
             return;
        }
        if (callActiveRef.current && !isProcessingRef.current && e.error !== 'aborted') {
             setTimeout(() => {
                try { recognitionRef.current?.start(); } catch (err) {}
             }, 100);
        }
    };

    recognitionRef.current.onend = () => {
        if (callActiveRef.current && !isProcessingRef.current && callStatus !== 'error') {
            setTimeout(() => {
                try { recognitionRef.current?.start(); } catch(e) {}
            }, 100);
        }
    };
       
    try {
      recognitionRef.current.start();
    } catch (e) {
      setCallStatus('error');
      setErrorMessage("Microphone failed to start.");
    }
  };

  const normalizeText = (text: string) => {
     return text.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") // Remove punctuation
        .replace(/\s{2,}/g, " ") // Remove extra spaces
        .replace(/s\s?15/g, 's15') // "s 15" -> "s15"
        .replace(/s-15/g, 's15')
        .replace(/es fifteen/g, 's15')
        .trim();
  };

  const processVoiceInput = async (text: string) => {
     // Security / Wake Word Check
     if (voiceSecurityKey) {
        const normalizedInput = normalizeText(text);
        const normalizedKey = normalizeText(voiceSecurityKey);
        
        if (!normalizedInput.includes(normalizedKey)) {
           // Ignore input if security key is set but not spoken
           console.log("Ignored: Security phrase missing");
           return;
        }

        // If the input IS strictly just the wake word (or very close), respond simply
        if (normalizedInput === normalizedKey) {
             speakResponse("I'm here. How can I help?");
             return;
        }
     }

     isProcessingRef.current = true;
     setCallStatus('speaking');

     try {
       if (!chatSessionRef.current) initChat(ModelMode.FAST_SEARCH);
       
       const result = await chatSessionRef.current!.sendMessage({ message: text });
       const responseText = result.text || "Command executed.";
       
       setMessages(prev => [
           ...prev, 
           { id: Date.now().toString(), role: 'user', text: text },
           { id: (Date.now()+1).toString(), role: 'model', text: responseText }
       ]);

       speakResponse(responseText);
     } catch (e) {
       console.error("Voice processing failed", e);
       isProcessingRef.current = false;
       speakResponse("System error.");
     }
  };

  const speakResponse = (text: string) => {
       isProcessingRef.current = true;
       setCallStatus('speaking');
       const utterance = new SpeechSynthesisUtterance(text);
       utterance.pitch = voicePitch;
       utterance.rate = voiceRate;
       
       if (selectedVoiceURI) {
         const voice = availableVoices.find(v => v.voiceURI === selectedVoiceURI);
         if (voice) utterance.voice = voice;
       }

       utterance.onend = () => {
         isProcessingRef.current = false;
         if (callActiveRef.current) {
            setCallStatus('listening');
            try { recognitionRef.current?.start(); } catch(e) {}
         }
       };
       
       utterance.onerror = () => {
           isProcessingRef.current = false;
           if(callActiveRef.current) try { recognitionRef.current?.start(); } catch(e) {}
       }
       
       synthRef.current.speak(utterance);
  };

  // --- RENDERING ---

  if (showLogin) {
    // ... (Login Code same as before) ...
    return (
      <div className="fixed inset-0 bg-s15-900 flex flex-col items-center justify-center p-6 z-50 overflow-y-auto">
        <div className="w-full max-w-md bg-slate-800/50 rounded-2xl p-8 border border-slate-700 shadow-2xl flex flex-col items-center animate-fadeIn">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-s15-accent to-indigo-600 flex items-center justify-center shadow-lg shadow-s15-accent/20 mb-6">
             <span className="font-bold text-white text-xl tracking-tighter">S15</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">{isSignUp ? 'Create Account' : 'Welcome Back'}</h1>
          <p className="text-slate-400 text-center mb-6 text-sm">
            {isSignUp ? 'Join the next generation of intelligence.' : 'Sign in to access your projects.'}
          </p>
          
          <form onSubmit={handleAuth} className="w-full space-y-4">
            {isSignUp && (
              <div className="space-y-1">
                 <div className="relative">
                   <UserIcon size={16} className="absolute left-3 top-3.5 text-slate-500" />
                   <input 
                     type="text" 
                     placeholder="Full Name"
                     value={authName}
                     onChange={e => setAuthName(e.target.value)}
                     className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:border-s15-accent focus:ring-1 focus:ring-s15-accent outline-none" 
                     required
                   />
                 </div>
              </div>
            )}
            <div className="space-y-1">
               <div className="relative">
                 <Mail size={16} className="absolute left-3 top-3.5 text-slate-500" />
                 <input 
                   type="email" 
                   placeholder="Email address" 
                   value={email}
                   onChange={e => setEmail(e.target.value)}
                   className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:border-s15-accent focus:ring-1 focus:ring-s15-accent outline-none" 
                   required
                 />
               </div>
            </div>
            <div className="space-y-1">
               <div className="relative">
                 <LogIn size={16} className="absolute left-3 top-3.5 text-slate-500" />
                 <input 
                   type="password" 
                   placeholder="Password"
                   value={password}
                   onChange={e => setPassword(e.target.value)}
                   className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:border-s15-accent focus:ring-1 focus:ring-s15-accent outline-none" 
                   required
                 />
               </div>
            </div>
            {authError && <div className="text-red-400 text-xs text-center">{authError}</div>}
            <button 
              type="submit"
              className={`w-full font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-colors active:scale-98 bg-s15-accent text-slate-900 hover:bg-s15-glow`}
            >
              {isSignUp ? <><UserPlus size={18} /> Create Account</> : <><ArrowRight size={18} /> Sign In</>}
            </button>
            <div className="flex items-center gap-3 py-2">
               <div className="h-px bg-slate-700 flex-1" />
               <span className="text-slate-500 text-xs">OR</span>
               <div className="h-px bg-slate-700 flex-1" />
            </div>
            <button 
              type="button"
              onClick={handleGoogleLogin}
              className="w-full font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-colors active:scale-98 bg-white text-slate-900 hover:bg-gray-100"
            >
               <svg viewBox="0 0 24 24" className="w-5 h-5">
                 <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                 <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                 <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26-.19-.58z" />
                 <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
               </svg>
               Continue with Google
            </button>
          </form>
          <div className="mt-6 flex flex-col items-center gap-3 w-full">
            <button 
               type="button"
               onClick={() => { setIsSignUp(!isSignUp); setAuthError(''); }}
               className="text-xs text-s15-accent hover:text-white transition-colors py-2"
            >
              {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Create one"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Permissions Screen - BLOCKS APP UNTIL GRANTED OR SKIPPED
  if (!permissionsGranted) {
      return (
          <div className="fixed inset-0 bg-s15-900 z-50 flex flex-col items-center justify-center p-6 animate-fadeIn">
              <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center mb-8 relative">
                   <div className="absolute inset-0 bg-s15-accent/20 rounded-full animate-pulse"></div>
                   <Shield size={32} className="text-s15-accent z-10" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-4 text-center">System Access Required</h2>
              <p className="text-slate-400 text-center max-w-sm mb-6">
                  S15 requires control of audio sensors to function as your assistant.
              </p>
              
              {/* Error Message Display */}
              {permissionError && (
                 <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-3 mb-6 max-w-sm w-full flex items-start gap-2">
                    <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-300 text-xs text-left">{permissionError}</p>
                 </div>
              )}

              <div className="flex flex-col gap-4 w-full max-w-xs">
                <button 
                    onClick={requestMediaPermissions}
                    className="bg-s15-accent hover:bg-s15-glow text-slate-900 font-bold py-4 px-8 rounded-2xl flex items-center justify-center gap-3 transition-transform active:scale-95 shadow-xl shadow-s15-accent/20"
                >
                    <CheckCircle size={20} />
                    Initialize System
                </button>
                
                <button 
                    onClick={handleTextOnlyMode}
                    className="bg-transparent border border-slate-700 hover:bg-slate-800 text-slate-400 font-medium py-3 px-8 rounded-xl flex items-center justify-center gap-2 transition-colors text-sm"
                >
                    <Keyboard size={16} />
                    Enter Text Only Mode
                </button>
              </div>
          </div>
      );
  }

  // Voice Call Overlay
  if (isCallActive) {
    return (
      <div className="fixed inset-0 bg-s15-900 z-50 flex flex-col items-center justify-between py-12 px-6 animate-fadeIn safe-pb">
         
         {/* Voice Settings Dropdown */}
         <div className="absolute top-6 right-6 z-20">
           <div className="relative">
             <button 
               onClick={() => setShowVoiceSettings(!showVoiceSettings)}
               className="p-3 bg-slate-800 rounded-full text-slate-300 hover:text-white shadow-lg border border-slate-700"
             >
               <Settings size={20} />
             </button>
             
             {showVoiceSettings && (
               <div className="absolute right-0 top-14 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-2 animate-fadeIn max-h-[70vh] overflow-y-auto">
                 <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                   <Lock size={12} /> Voice Security
                 </div>
                 <div className="px-2 mb-4">
                    <input 
                        type="text" 
                        placeholder="Set Wake Phrase (e.g. Hey S15)" 
                        value={voiceSecurityKey}
                        onChange={(e) => {
                            const val = e.target.value;
                            setVoiceSecurityKey(val);
                            localStorage.setItem('s15_voice_security_key', val);
                        }}
                        className="w-full bg-slate-900/50 border border-slate-600 rounded-lg p-2 text-sm text-white focus:border-s15-accent outline-none"
                    />
                    <div className="text-[10px] text-slate-500 mt-1">
                        {voiceSecurityKey ? "AI will only respond if phrase is spoken." : "Security disabled. AI responds to all speech."}
                    </div>
                 </div>

                 {/* New Voice Style Controls */}
                 <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                   <Sliders size={12} /> Voice Style
                 </div>
                 <div className="px-3 space-y-3 mb-4">
                    <div>
                        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                           <span>Pitch</span>
                           <span>{voicePitch.toFixed(1)}</span>
                        </div>
                        <input 
                           type="range" min="0.5" max="2" step="0.1" 
                           value={voicePitch} 
                           onChange={(e) => {
                               const val = parseFloat(e.target.value);
                               setVoicePitch(val);
                               localStorage.setItem('s15_voice_pitch', val.toString());
                           }}
                           className="w-full accent-s15-accent h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                           <span>Speed</span>
                           <span>{voiceRate.toFixed(1)}</span>
                        </div>
                        <input 
                           type="range" min="0.5" max="2" step="0.1" 
                           value={voiceRate} 
                           onChange={(e) => {
                               const val = parseFloat(e.target.value);
                               setVoiceRate(val);
                               localStorage.setItem('s15_voice_rate', val.toString());
                           }}
                           className="w-full accent-s15-accent h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                 </div>

                 <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                   <Volume2 size={12} /> Voice Selection
                 </div>
                 {availableVoices.length > 0 ? availableVoices.map((v) => (
                   <button
                     key={v.voiceURI}
                     onClick={() => {
                        setSelectedVoiceURI(v.voiceURI);
                        localStorage.setItem('s15_selected_voice_uri', v.voiceURI);
                     }}
                     className={`w-full text-left px-3 py-2 text-sm rounded-lg truncate ${
                       selectedVoiceURI === v.voiceURI ? 'bg-s15-accent text-slate-900 font-medium' : 'text-slate-300 hover:bg-slate-700'
                     }`}
                   >
                     {v.name}
                   </button>
                 )) : (
                   <div className="px-3 py-2 text-sm text-slate-500">No voices available</div>
                 )}
               </div>
             )}
           </div>
         </div>

         <div className="flex-1 flex flex-col items-center justify-center w-full">
            <div className="text-slate-400 text-xs font-medium mb-16 uppercase tracking-[0.2em] opacity-80">
                {voiceSecurityKey ? `SECURE CHANNEL: ${voiceSecurityKey}` : 'S15 SYSTEM ACTIVE'}
            </div>
            
            <div className="relative h-64 w-full flex items-center justify-center">
              {callStatus === 'speaking' ? (
                 <div className="flex items-center justify-center gap-2 h-32">
                    <div className="voice-bar h-16" style={{ animationDelay: '0s' }}></div>
                    <div className="voice-bar h-24" style={{ animationDelay: '0.1s' }}></div>
                    <div className="voice-bar h-12" style={{ animationDelay: '0.2s' }}></div>
                    <div className="voice-bar h-20" style={{ animationDelay: '0.3s' }}></div>
                    <div className="voice-bar h-14" style={{ animationDelay: '0.4s' }}></div>
                 </div>
              ) : callStatus === 'error' ? (
                  <div className="flex flex-col items-center justify-center">
                     <div className="w-32 h-32 rounded-full border-2 border-red-500/50 flex items-center justify-center bg-red-500/10 mb-4 animate-pulse">
                         <AlertCircle size={48} className="text-red-500" />
                     </div>
                     <button 
                        onClick={() => startListening()}
                        className="px-4 py-2 bg-slate-800 rounded-full text-sm text-slate-300 border border-slate-700 hover:bg-slate-700"
                     >
                        Re-initialize Sensors
                     </button>
                  </div>
              ) : (
                 <div className="relative flex items-center justify-center">
                    {/* New Digital Orb Design */}
                    <div className="absolute w-48 h-48 rounded-full bg-s15-accent/5 animate-[pulse_3s_ease-in-out_infinite]"></div>
                    <div className="absolute w-40 h-40 rounded-full border border-s15-accent/20 flex items-center justify-center animate-[spin_10s_linear_infinite]">
                        <div className="w-2 h-2 bg-s15-accent rounded-full absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1"></div>
                    </div>
                    <div className="absolute w-32 h-32 rounded-full border border-indigo-500/20 flex items-center justify-center animate-[spin_15s_linear_infinite_reverse]">
                         <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1"></div>
                    </div>

                    <button 
                      className="relative z-10 w-24 h-24 rounded-full bg-slate-900 shadow-[0_0_50px_rgba(6,182,212,0.3)] flex items-center justify-center text-white ring-1 ring-white/10 active:scale-95 transition-transform overflow-hidden group"
                      onClick={() => {
                         if (callStatus !== 'listening') startListening();
                      }}
                    >
                       <div className="absolute inset-0 bg-gradient-to-b from-s15-accent/20 to-indigo-600/20 group-hover:opacity-100 transition-opacity opacity-50"></div>
                       <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                       <div className="relative z-20 bg-clip-text text-transparent bg-gradient-to-br from-white to-slate-400 font-bold text-lg">
                          S15
                       </div>
                    </button>
                 </div>
              )}
            </div>

            <div className="mt-16 flex flex-col items-center gap-2">
              <div className="text-2xl font-light text-white text-center tracking-tight min-h-[40px]">
                {callStatus === 'connecting' && <span className="animate-pulse">Initializing...</span>}
                {callStatus === 'listening' && (voiceSecurityKey ? `Waiting for "${voiceSecurityKey}"...` : "Listening...")}
                {callStatus === 'speaking' && "Executing..."}
                {callStatus === 'error' && <span className="text-red-400 text-lg">{errorMessage || "Sensor Error"}</span>}
              </div>
              <p className="text-slate-500 text-sm">
                {callStatus === 'listening' ? "Tap orb to reset" : callStatus === 'error' ? "Check system settings" : "Tap to interrupt"}
              </p>
            </div>
         </div>

         <div className="w-full flex justify-center pb-8">
            <button 
              onClick={endVoiceCall}
              className="bg-slate-800 hover:bg-slate-700 text-white rounded-full p-4 border border-slate-700 shadow-lg transition-all active:scale-95"
            >
              <X size={28} />
            </button>
         </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-full h-[100dvh] bg-s15-900 text-slate-100 font-sans overflow-hidden flex flex-col selection:bg-s15-accent/30">
      
      {/* Sidebar */}
      <Sidebar 
        isOpen={showSidebar} 
        onClose={() => setShowSidebar(false)} 
        sessions={sessions}
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        userName={user?.name}
        onLogout={handleLogout}
      />

      {/* Header */}
      <header className="flex-shrink-0 h-16 bg-s15-900 border-b border-slate-800/50 flex items-center justify-between px-4 z-30 shadow-sm relative">
        <div className="flex items-center gap-3">
           <button 
             onClick={() => setShowSidebar(true)}
             className="p-2 -ml-2 text-slate-400 hover:text-white"
           >
             <Menu size={24} />
           </button>
           
           <div className="w-9 h-9 rounded-full bg-gradient-to-br from-s15-accent to-indigo-600 flex items-center justify-center shadow-lg shadow-s15-accent/20">
              <span className="font-bold text-white text-xs tracking-tighter">S15</span>
           </div>
           <div className="flex flex-col">
              <span className="font-semibold text-lg tracking-tight text-slate-200 leading-none">S15</span>
              {user && <span className="text-[10px] text-slate-400">System: {user.name}</span>}
           </div>
        </div>
        
        <div className="flex items-center gap-2">
           <button
             onClick={startVoiceCall}
             className="p-3 text-slate-400 hover:text-s15-accent active:bg-slate-800 rounded-full transition-colors touch-manipulation active:scale-95 relative"
             title="Voice Command"
           >
             <div className="absolute top-3 right-3 w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
             <Phone size={20} />
           </button>
           <button 
             onClick={handleNewChat}
             className="p-3 text-slate-400 hover:text-red-400 active:bg-slate-800 rounded-full transition-colors touch-manipulation active:scale-95"
             title="Reset"
           >
             <Trash2 size={20} />
           </button>
        </div>
      </header>

      {/* Main Chat Area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth overscroll-none w-full">
        <div className="w-full max-w-3xl mx-auto px-4 py-6 min-h-full flex flex-col">
          
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-0 animate-[fadeIn_0.5s_ease-out_forwards] px-4 pb-20">
              <div className="w-20 h-20 rounded-3xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-center mb-6 shadow-2xl shadow-s15-accent/10 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-s15-accent/10 to-transparent opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <Sparkles size={40} className="text-s15-accent relative z-10" />
              </div>
              <h2 className="text-2xl font-bold text-slate-100 mb-2">Systems Online, {user?.name}.</h2>
              <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
                Full control enabled. <br/>
                Sensors calibrated. Ready for instruction.
              </p>
            </div>
          ) : (
            <div className="flex-1 pb-4">
              {messages.map(msg => (
                <MessageItem key={msg.id} message={msg} userAvatar={user?.avatarUrl} />
              ))}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
          
        </div>
      </main>

      {/* Input Footer */}
      <footer className="flex-shrink-0 bg-s15-900 border-t border-slate-800/50 z-30 safe-pb shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <InputArea 
          onSendMessage={handleSendMessage} 
          isLoading={isLoading} 
          mode={mode}
          onModeChange={handleModeChange}
        />
      </footer>
    </div>
  );
};

export default App;