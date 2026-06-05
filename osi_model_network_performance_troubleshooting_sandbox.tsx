import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot } from 'firebase/firestore';

// Initialize Firebase services outside of the component safely
let app, auth, db;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'osi-troubleshoot-app';

try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    const firebaseConfig = JSON.parse(__firebase_config);
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
} catch (e) {
  console.error("Firebase initialization skipped or failed:", e);
}

// Main Application Component
export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('sandbox'); // 'sandbox' | 'exam' | 'quiz'

  // --- Firebase / Storage State ---
  const [user, setUser] = useState(null);
  const [studentRecords, setStudentRecords] = useState([]);
  const [studentName, setStudentName] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // --- Sandbox Simulation State ---
  const [bandwidth, setBandwidth] = useState(100); // Mbps (L1)
  const [rtt, setRtt] = useState(80); // ms (L3)
  const [tcpWindow, setTcpWindow] = useState(240); // KB (L4)
  const [simRunning, setSimRunning] = useState(true);
  const [packetTick, setPacketTick] = useState(0);

  // --- Exam State ---
  const [partAInput, setPartAInput] = useState('');
  const [partBInput, setPartBInput] = useState('');
  const [submittedAnswers, setSubmittedAnswers] = useState(false);
  const [examFeedback, setExamFeedback] = useState(null);
  const [activeScratchpad, setActiveScratchpad] = useState('text'); // 'text' | 'draw'
  const [scratchpadText, setScratchpadText] = useState('');
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // --- Quiz State ---
  const [quizScore, setQuizScore] = useState(0);
  const [completedScenarios, setCompletedScenarios] = useState({});
  const [activeScenarioIdx, setActiveScenarioIdx] = useState(0);
  const [showQuizResult, setShowQuizResult] = useState(false);

  // --- AI Network Assistant State ---
  const [aiInput, setAiInput] = useState('');
  const [chatHistory, setChatHistory] = useState([
    {
      role: 'assistant',
      text: "Hello! I am your OSI Troubleshooting Assistant. Ask me anything about BDP calculations, physical link limits, transport window tuning, or OSI layer troubleshooting!"
    }
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // --- Scenarios Data for Quiz ---
  const scenarios = [
    {
      id: 1,
      title: "Attenuation & Splicing",
      description: "A technician notices a high optical loss on a single-mode fiber-optic run between floors. Redirection shows a microscopic fracture inside the fiber cable casing causing light to leak out.",
      layer: 1,
      layerName: "Physical Layer (Layer 1)",
      explanation: "Signal attenuation, cable physical integrity, and connector termination are physical characteristics governed directly by Layer 1."
    },
    {
      id: 2,
      title: "Duplex Mismatch Collision",
      description: "A fast Ethernet link displays an immense rate of Late Collisions and FCS (Frame Check Sequence) errors on Switch port 24. The router interface is locked to Full-Duplex while the switch is on Auto-Negotiate.",
      layer: 2,
      layerName: "Data Link Layer (Layer 2)",
      explanation: "Framing, MAC layer collisions, half/full duplex parameters, and checksum failures are handled at the Data Link Layer (Layer 2)."
    },
    {
      id: 3,
      title: "Subnet Routing Loop",
      description: "Pings to an external resource fail with a 'TTL expired in transit' notification. Traceroute reveals that packets are bouncing endlessly between two intermediate local routers.",
      layer: 3,
      layerName: "Network Layer (Layer 3)",
      explanation: "Routing path decisions, IP addressing, TTL parameters, and ICMP messaging are core operations of the Network Layer (Layer 3)."
    },
    {
      id: 4,
      title: "Port Exhaustion & Flow Control",
      description: "A highly parallel scraping server can no longer establish outbound connections. Netstat shows thousands of sockets in the TIME_WAIT state, indicating TCP source port depletion.",
      layer: 4,
      layerName: "Transport Layer (Layer 4)",
      explanation: "Port multiplexing, TCP state management (TIME_WAIT, ESTABLISHED), window flow control, and segment reassembly reside at the Transport Layer (Layer 4)."
    },
    {
      id: 5,
      title: "Token Auth Timeout",
      description: "An interactive database client connection drops abruptly every 30 minutes. Logs show the underlying TCP link remains fully open, but the remote SQL daemon forced a state logout due to credential life expiry.",
      layer: 5,
      layerName: "Session Layer (Layer 5)",
      explanation: "Session layer manages establishment, checkpointing, and termination of conversations/sessions between applications."
    },
    {
      id: 6,
      title: "Cipher Mismatch Failure",
      description: "During a secure transfer, the browser abruptly terminates the connection with an 'SSL_ERROR_NO_CYPHER_OVERLAP' alert. The server's available decryption algorithms are too outdated for the client.",
      layer: 6,
      layerName: "Presentation Layer (Layer 6)",
      explanation: "Data representation, SSL/TLS encryption/decryption, character set translation, and compression occur at the Presentation Layer (Layer 6)."
    },
    {
      id: 7,
      title: "API Endpoint Redirect Loop",
      description: "A user tries to fetch static profile data, but receives an HTTP status code 502 Bad Gateway. Web service logs point to a malfunctioning microservices gateway failing to map API route requests.",
      layer: 7,
      layerName: "Application Layer (Layer 7)",
      explanation: "High-level service communications like HTTP codes, DNS queries, SMTP, and application-specific semantics exist at the Application Layer (Layer 7)."
    }
  ];

  // --- Compute Simulation Outputs ---
  const bdpBytes = (bandwidth * 1000000 * (rtt / 1000)) / 8;
  const tcpWindowBytes = tcpWindow * 1024;
  
  // Max Throughput formula: Throughput = Min(Capacity, Window / RTT)
  const windowThroughputMbps = ((tcpWindowBytes * 8) / (rtt / 1000)) / 1000000;
  const actualThroughput = Math.min(bandwidth, windowThroughputMbps);
  const utilization = (actualThroughput / bandwidth) * 100;

  // --- Auth Setup (Rule 3) ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Authentication setup failed:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- Classroom Board Listeners (Rule 1 & Rule 2) ---
  useEffect(() => {
    if (!db || !user) return;
    // Rule 1: Public path for collaborative class diagnostics records
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'student_records');
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = [];
      snapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() });
      });
      // Rule 2: Sort client-side instead of compound orderBy/where queries
      records.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
      setStudentRecords(records);
    }, (err) => {
      console.error("Firestore loading failure:", err);
    });

    return () => unsubscribe();
  }, [user]);

  // --- Sync score function (Rule 1) ---
  const syncScoreToCloud = async () => {
    if (!db || !user || !studentName.trim()) return;
    setIsSyncing(true);
    try {
      const activeExamScore = submittedAnswers ? (examFeedback?.a?.correct ? 10 : 0) + (examFeedback?.b?.correct ? 10 : 0) : 0;
      const combinedScore = quizScore + activeExamScore;
      const recordRef = doc(db, 'artifacts', appId, 'public', 'data', 'student_records', user.uid);
      
      await setDoc(recordRef, {
        name: studentName,
        score: combinedScore,
        scratchpad: scratchpadText || 'None',
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("Firestore syncing failure:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- Simulation Animation Tick ---
  useEffect(() => {
    let intervalId;
    if (simRunning) {
      intervalId = setInterval(() => {
        setPacketTick((prev) => (prev + 1) % 100);
      }, 50);
    }
    return () => clearInterval(intervalId);
  }, [simRunning]);

  // --- Whiteboard Draw Logic ---
  useEffect(() => {
    if (activeTab === 'exam' && activeScratchpad === 'draw' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
    }
  }, [activeTab, activeScratchpad]);

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // --- Check Exam Answers ---
  const handleCheckExam = () => {
    const ansA = parseFloat(partAInput);
    const ansB = parseFloat(partBInput);

    const correctA = 1000000;
    const correctB = 240000;

    const marginA = Math.abs(ansA - correctA) / correctA;
    const marginB = Math.abs(ansB - correctB) / correctB;

    const isACorrect = !isNaN(ansA) && marginA <= 0.02; // within 2% tolerance
    const isBCorrect = !isNaN(ansB) && marginB <= 0.02; // within 2% tolerance

    setExamFeedback({
      a: {
        correct: isACorrect,
        val: ansA,
        expected: correctA,
      },
      b: {
        correct: isBCorrect,
        val: ansB,
        expected: correctB,
      }
    });
    setSubmittedAnswers(true);
  };

  // --- Reset Exam ---
  const handleResetExam = () => {
    setPartAInput('');
    setPartBInput('');
    setSubmittedAnswers(false);
    setExamFeedback(null);
    setScratchpadText('');
    if (activeScratchpad === 'draw') {
      clearCanvas();
    }
  };

  // --- Quiz Interaction ---
  const handleSelectLayer = (selectedLayer) => {
    const currentScenario = scenarios[activeScenarioIdx];
    const isCorrect = selectedLayer === currentScenario.layer;

    setCompletedScenarios(prev => ({
      ...prev,
      [currentScenario.id]: {
        isCorrect,
        selected: selectedLayer
      }
    }));

    if (isCorrect) {
      setQuizScore(prev => prev + 1);
    }
  };

  const handleNextScenario = () => {
    if (activeScenarioIdx < scenarios.length - 1) {
      setActiveScenarioIdx(prev => prev + 1);
    } else {
      setShowQuizResult(true);
    }
  };

  const handleResetQuiz = () => {
    setQuizScore(0);
    setCompletedScenarios({});
    setActiveScenarioIdx(0);
    setShowQuizResult(false);
  };

  // --- API Call Integration (AI Assistant) ---
  const callNetworkAI = async () => {
    if (!aiInput.trim()) return;
    const userQuery = aiInput;
    setAiInput('');
    setIsAiLoading(true);
    setAiError('');

    setChatHistory(prev => [...prev, { role: 'user', text: userQuery }]);

    const apiKey = "";
    const systemPrompt = "You are an expert Network Engineering Instructor specializing in the OSI Model and Network Performance Analysis. Explain troubleshooting concepts, Bandwidth-Delay Product (BDP), sliding window flow control, or walk through the mathematical relations between latency, window size, and throughput. Keep explanations clear, professional, and well-structured. For formatting, do not use raw markdown blocks if possible, write clearly in paragraphs and bullets.";

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: userQuery }] }],
              systemInstruction: { parts: [{ text: systemPrompt }] }
            })
          }
        );

        if (!response.ok) {
          throw new Error(`API returned error code ${response.status}`);
        }

        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No explanation returned.";

        setChatHistory(prev => [...prev, { role: 'assistant', text: responseText }]);
        setIsAiLoading(false);
        return; // Success
      } catch (err) {
        attempts++;
        if (attempts >= maxAttempts) {
          setAiError("Connection to the network helper timed out. Please try again.");
          setIsAiLoading(false);
          break;
        }
        const delay = Math.pow(2, attempts) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };

  // --- SVG Packet Simulation Helpers ---
  const renderSimulationTrack = () => {
    const width = 600;
    const height = 140;
    const pipeY = 70;
    const clientX = 80;
    const serverX = 520;

    const packetSpacings = [];
    const isBottlenecked = tcpWindowBytes < bdpBytes;
    const totalSimPackets = isBottlenecked ? 5 : 12;

    for (let i = 0; i < totalSimPackets; i++) {
      let progress = (packetTick + (i * (100 / totalSimPackets))) % 100;
      if (isBottlenecked && progress > 55) {
        continue; 
      }
      const x = clientX + (progress / 100) * (serverX - clientX);
      packetSpacings.push({ id: `pkt-${i}`, x });
    }

    const ackSpacings = [];
    for (let i = 0; i < totalSimPackets; i++) {
      let progress = (packetTick + (i * (100 / totalSimPackets)) + 50) % 100;
      if (isBottlenecked && progress > 55) {
        continue;
      }
      const x = serverX - (progress / 100) * (serverX - clientX);
      ackSpacings.push({ id: `ack-${i}`, x });
    }

    return (
      <svg className="w-full h-44 bg-slate-900/60 rounded-xl border border-slate-700/50" viewBox={`0 0 ${width} ${height}`}>
        <line 
          x1={clientX} 
          y1={pipeY} 
          x2={serverX} 
          y2={pipeY} 
          stroke="#334155" 
          strokeWidth="14" 
          strokeLinecap="round" 
        />
        <line 
          x1={clientX} 
          y1={pipeY} 
          x2={serverX} 
          y2={pipeY} 
          stroke="#0ea5e9" 
          strokeWidth="6" 
          strokeLinecap="round" 
          className="opacity-40 animate-pulse"
        />

        <g transform={`translate(${clientX}, ${pipeY})`}>
          <circle r="22" fill="#1e1b4b" stroke="#38bdf8" strokeWidth="2.5" />
          <text fill="#ffffff" fontSize="11" fontWeight="bold" textAnchor="middle" y="4">Client A</text>
          <text fill="#38bdf8" fontSize="8" textAnchor="middle" y="32" className="font-mono">192.168.1.10</text>
        </g>

        <g transform={`translate(${serverX}, ${pipeY})`}>
          <circle r="22" fill="#1e1b4b" stroke="#6366f1" strokeWidth="2.5" />
          <text fill="#ffffff" fontSize="11" fontWeight="bold" textAnchor="middle" y="4">Server B</text>
          <text fill="#6366f1" fontSize="8" textAnchor="middle" y="32" className="font-mono">10.0.0.50</text>
        </g>

        {packetSpacings.map((p) => (
          <circle 
            key={p.id}
            cx={p.x}
            cy={pipeY - 2}
            r="4.5"
            fill="#38bdf8"
            className="drop-shadow-[0_0_6px_#0ea5e9]"
          />
        ))}

        {ackSpacings.map((a) => (
          <circle 
            key={a.id}
            cx={a.x}
            cy={pipeY + 2}
            r="3"
            fill="#818cf8"
            className="drop-shadow-[0_0_4px_#6366f1]"
          />
        ))}

        <text x={width / 2} y="22" fill="#94a3b8" fontSize="10" textAnchor="middle" className="tracking-wide">
          ACTUAL TRANSFER FLOW RATE
        </text>
        <text x={width / 2} y="40" fill="#38bdf8" fontSize="15" fontWeight="bold" textAnchor="middle">
          {actualThroughput.toFixed(1)} Mbps
        </text>
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Premium Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-sky-500 to-indigo-600 rounded-lg shadow-lg shadow-sky-500/15">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
                OSi Model and Association with Network Troubleshooting
              </h1>
              <p className="text-xs text-slate-400">Interactive Network Diagnostics, Sandbox & Exam Board</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex bg-slate-800/80 p-1 rounded-xl border border-slate-700">
            <button
              onClick={() => setActiveTab('sandbox')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'sandbox' 
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/10' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              Interactive Sandbox
            </button>
            <button
              onClick={() => setActiveTab('exam')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'exam' 
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/10' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              Show-Your-Work Exam
            </button>
            <button
              onClick={() => setActiveTab('quiz')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'quiz' 
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/10' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              OSI Troubleshooting Match
            </button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Columns for Interactive Sandbox, Exam or Quiz */}
        <div className="lg:col-span-2 space-y-6">

          {/* TAB 1: INTERACTIVE SANDBOX */}
          {activeTab === 'sandbox' && (
            <div className="space-y-6">
              {/* Introduction Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5">
                  <svg className="w-32 h-32 text-sky-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2zm2-4H5V5h14v4z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-white mb-2">Layer 1-4 Performance Sandbox</h2>
                <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                  Adjust standard parameters at the <strong>Physical Layer (L1 Bandwidth)</strong>, <strong>Network Layer (L3 Round-Trip Time)</strong>, and <strong>Transport Layer (L4 TCP Window Size)</strong>. Watch in real-time how a small TCP window creates dead periods in transit, capping your real performance far below the network speed!
                </p>
              </div>

              {/* Real-time Packet Animation */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-slate-300 tracking-wider uppercase">Active Network Pipeline Simulation</h3>
                  <button 
                    onClick={() => setSimRunning(!simRunning)}
                    className={`px-3 py-1 text-xs rounded-lg font-semibold transition ${
                      simRunning ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {simRunning ? 'Pause Sim' : 'Resume Sim'}
                  </button>
                </div>
                {renderSimulationTrack()}
              </div>

              {/* Sliders and Metrics Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Sliders panel */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
                  <h3 className="text-sm font-semibold text-sky-400 border-b border-slate-800 pb-2">Network Layer Settings</h3>
                  
                  {/* Bandwidth (L1) */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-xs text-slate-400 uppercase font-semibold">Physical Link Capacity (Bandwidth)</label>
                      <span className="text-sm font-bold text-sky-400">{bandwidth} Mbps</span>
                    </div>
                    <input 
                      type="range" 
                      min="10" 
                      max="1000" 
                      step="10"
                      value={bandwidth}
                      onChange={(e) => setBandwidth(Number(e.target.value))}
                      className="w-full accent-sky-400 bg-slate-800"
                    />
                    <p className="text-[10px] text-slate-500">Layer 1 Physical parameter limiting maximum possible throughput.</p>
                  </div>

                  {/* Latency (L3) */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-xs text-slate-400 uppercase font-semibold">Round-Trip Time (RTT)</label>
                      <span className="text-sm font-bold text-sky-400">{rtt} ms</span>
                    </div>
                    <input 
                      type="range" 
                      min="10" 
                      max="500" 
                      step="5"
                      value={rtt}
                      onChange={(e) => setRtt(Number(e.target.value))}
                      className="w-full accent-sky-400 bg-slate-800"
                    />
                    <p className="text-[10px] text-slate-500">Layer 3 Network round-trip delay calculated via ICMP ping utility.</p>
                  </div>

                  {/* TCP Window (L4) */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-xs text-slate-400 uppercase font-semibold">TCP Sliding Window Size</label>
                      <span className="text-sm font-bold text-indigo-400">{tcpWindow} KB</span>
                    </div>
                    <input 
                      type="range" 
                      min="16" 
                      max="4096" 
                      step="16"
                      value={tcpWindow}
                      onChange={(e) => setTcpWindow(Number(e.target.value))}
                      className="w-full accent-indigo-400 bg-slate-800"
                    />
                    <p className="text-[10px] text-slate-500">Layer 4 Transport flow-control buffer capacity before requiring an ACK acknowledgement.</p>
                  </div>
                </div>

                {/* Live Computations / Analytics */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-400 border-b border-slate-800 pb-2 mb-4">Calculated Diagnostics</h3>
                    
                    <div className="space-y-4">
                      {/* BDP */}
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-medium">Bandwidth-Delay Product (BDP)</div>
                        <div className="text-xl font-mono font-bold text-white">
                          {bdpBytes.toLocaleString()} <span className="text-xs font-normal text-slate-400">Bytes</span>
                        </div>
                        <p className="text-[10px] text-slate-500">Optimal Layer 4 socket buffer size to completely fill the link capacity.</p>
                      </div>

                      {/* Current Buffer Allocated */}
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-medium">Your TCP Window Size</div>
                        <div className="text-xl font-mono font-bold text-indigo-300">
                          {tcpWindowBytes.toLocaleString()} <span className="text-xs font-normal text-slate-400">Bytes</span>
                        </div>
                      </div>

                      {/* BDP Buffer Comparison Indicator */}
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        {tcpWindowBytes >= bdpBytes ? (
                          <div className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
                            Link Saturated: Optimal performance achieved!
                          </div>
                        ) : (
                          <div className="text-amber-400 text-xs font-semibold flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                            Under-buffered Bottleneck: Link is only {(utilization).toFixed(1)}% utilized.
                          </div>
                        )}
                        <p className="text-[10px] text-slate-400 mt-1">
                          {tcpWindowBytes >= bdpBytes 
                            ? "Your buffer size is greater than or equal to the link's capacity in flight. Throughput runs at maximum L1 speed." 
                            : `The server spends time waiting for packet acknowledgements before transmitting more data because window size (${tcpWindow} KB) < BDP (${(bdpBytes / 1024).toFixed(0)} KB).`}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Gauge indicator */}
                  <div className="pt-4 border-t border-slate-800/60 mt-4">
                    <div className="flex justify-between items-center text-xs text-slate-400 mb-1">
                      <span>LINK CAPACITY UTILIZATION</span>
                      <span className="font-mono font-bold text-white">{utilization.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${
                          utilization > 80 ? 'bg-emerald-500' : utilization > 40 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${utilization}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}


          {/* TAB 2: SHOW-YOUR-WORK EXAM */}
          {activeTab === 'exam' && (
            <div className="space-y-6">
              
              {/* Exam Question Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="bg-sky-500/10 text-sky-400 border border-sky-500/20 text-xs font-semibold px-2.5 py-1 rounded-md">
                      Ch. 1 Exam Question [20 Points]
                    </span>
                    <h2 className="text-xl font-bold text-white mt-3">
                      OSi Model and Association with Network Troubleshooting
                    </h2>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 text-xs uppercase block font-semibold">Points</span>
                    <span className="text-lg font-mono font-bold text-sky-400">20 Total</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 text-sm leading-relaxed space-y-3">
                  <p>
                    A network administrator is troubleshooting a slow file transfer between a client at Site A and a server at Site B. The physical network path has a maximum transmission capacity (Layer 1) of {"$C = 100 \\text{ Mbps}$"}. Using a Layer 3 ping utility, the round-trip time is determined to be constant at {"$RTT = 80.0 \\text{ ms}$"}. The administrator suspects a Layer 4 (Transport) configuration bottleneck rather than physical layer degradation.
                  </p>
                  <div className="pt-2 flex flex-col md:flex-row gap-4 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-sky-400"></span>
                      <span>Convert units to standard SI (bits, seconds)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-indigo-400"></span>
                      <span>Remember: 1 Byte = 8 bits</span>
                    </div>
                  </div>
                </div>

                {/* Subparts Prompt */}
                <div className="space-y-4 border-t border-slate-800/80 pt-4">
                  {/* Part A */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-white flex justify-between">
                      <span>Part a [10 Points]</span>
                      <span className="text-slate-500 text-xs">Category: L4 Optimal Buffer Size</span>
                    </h4>
                    <p className="text-xs text-slate-300">
                      Calculate the theoretical maximum Bandwidth-Delay Product (BDP) of the network link in **bytes**, representing the optimal Layer 4 receive buffer size.
                    </p>
                    <div className="flex gap-3 max-w-sm">
                      <input 
                        type="number" 
                        placeholder="e.g. 1000000"
                        value={partAInput}
                        onChange={(e) => setPartAInput(e.target.value)}
                        disabled={submittedAnswers}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm font-mono w-full text-white focus:outline-none focus:border-sky-500 disabled:opacity-50"
                      />
                      <span className="text-slate-400 self-center text-sm font-semibold">Bytes</span>
                    </div>
                  </div>

                  {/* Part B */}
                  <div className="space-y-2 border-t border-slate-800/40 pt-4">
                    <h4 className="text-sm font-semibold text-white flex justify-between">
                      <span>Part b [10 Points]</span>
                      <span className="text-slate-500 text-xs">Category: Window Flow Constraint</span>
                    </h4>
                    <p className="text-xs text-slate-300">
                      During active troubleshooting, the administrator runs a network throughput test and measures an actual file transfer rate of only {"$24.0 \\text{ Mbps}$"}. Assuming zero packet loss and that the performance limit is purely due to a misconfigured TCP window size, calculate the current TCP window size in **bytes**.
                    </p>
                    <div className="flex gap-3 max-w-sm">
                      <input 
                        type="number" 
                        placeholder="e.g. 240000"
                        value={partBInput}
                        onChange={(e) => setPartBInput(e.target.value)}
                        disabled={submittedAnswers}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm font-mono w-full text-white focus:outline-none focus:border-sky-500 disabled:opacity-50"
                      />
                      <span className="text-slate-400 self-center text-sm font-semibold">Bytes</span>
                    </div>
                  </div>
                </div>

                {/* Exam Submits Action */}
                <div className="flex gap-3 pt-4 border-t border-slate-800/80">
                  {!submittedAnswers ? (
                    <button
                      onClick={handleCheckExam}
                      className="px-6 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-sm rounded-lg shadow-md transition"
                    >
                      Verify My Calculation
                    </button>
                  ) : (
                    <button
                      onClick={handleResetExam}
                      className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm rounded-lg transition"
                    >
                      Reset Problem
                    </button>
                  )}
                </div>

                {/* Visual Feedback on Submission */}
                {submittedAnswers && examFeedback && (
                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Exam Results</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Feedback Part A */}
                      <div className={`p-3 rounded-lg border ${examFeedback.a.correct ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-300">Part A Feedback</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${examFeedback.a.correct ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {examFeedback.a.correct ? 'Correct [10/10]' : 'Incorrect [0/10]'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-2">
                          Your input: <span className="font-mono text-white">{examFeedback.a.val || "None"}</span><br/>
                          Target calculation answer: <span className="font-mono text-white">1,000,000 Bytes</span> (1 MB)
                        </p>
                      </div>

                      {/* Feedback Part B */}
                      <div className={`p-3 rounded-lg border ${examFeedback.b.correct ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-300">Part B Feedback</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${examFeedback.b.correct ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {examFeedback.b.correct ? 'Correct [10/10]' : 'Incorrect [0/10]'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-2">
                          Your input: <span className="font-mono text-white">{examFeedback.b.val || "None"}</span><br/>
                          Target calculation answer: <span className="font-mono text-white">240,000 Bytes</span> (240 KB)
                        </p>
                      </div>
                    </div>

                    {/* Step by step LaTeX math breakdown */}
                    <div className="bg-slate-900 p-4 rounded-lg border border-slate-800/80 mt-4 space-y-4">
                      <h4 className="text-xs font-bold text-sky-400 uppercase tracking-widest">Formal Mathematical worked_solution</h4>
                      
                      <div className="text-xs text-slate-300 space-y-3 leading-relaxed font-mono">
                        <div>
                          <strong>Given constants:</strong><br />
                          {"Link Capacity $C = 100 \\text{ Mbps} = 100 \\times 10^6 \\text{ bits/sec}$"}<br />
                          {"Round-Trip Time $RTT = 80.0 \\text{ ms} = 0.080 \\text{ sec}$"}
                        </div>

                        <div className="border-t border-slate-800 pt-2">
                          <strong>Part (a) Mathematical Formulation:</strong><br />
                          {"$$BDP = C \\times RTT = (100 \\times 10^6 \\text{ bits/sec}) \\times (0.080 \\text{ sec}) = 8,000,000 \\text{ bits}$$"}
                          {"$$\\text{BDP in Bytes} = \\frac{8,000,000 \\text{ bits}}{8} = 1,000,000 \\text{ Bytes} = 1 \\text{ MB}$$"}
                        </div>

                        <div className="border-t border-slate-800 pt-2">
                          <strong>Part (b) Mathematical Formulation:</strong><br />
                          {"The operational throughput $T$ is restricted by sliding window length $W$ over transmission cycle $RTT$:"}
                          {"$$T = \\frac{W}{RTT} \\implies W = T \\times RTT$$"}
                          {"$$\\text{With } T = 24 \\text{ Mbps} = 24 \\times 10^6 \\text{ bits/sec}:$$"}
                          {"$$W = (24 \\times 10^6 \\text{ bits/sec}) \\times (0.080 \\text{ sec}) = 1,920,000 \\text{ bits}$$"}
                          {"$$\\text{TCP Window Size in Bytes} = \\frac{1,920,000 \\text{ bits}}{8} = 240,000 \\text{ Bytes} = 240 \\text{ KB}$$"}
                        </div>
                      </div>
                    </div>

                  </div>
                )}

              </div>

              {/* Show Your Work Scratchpad/Whiteboard */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Exam Student Scratchpad</h3>
                    <p className="text-xs text-slate-400">Use this area to map out your conversion steps and division before verifying.</p>
                  </div>
                  
                  {/* Scratchpad Mode Toggle */}
                  <div className="flex gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                    <button
                      onClick={() => setActiveScratchpad('text')}
                      className={`px-3 py-1 text-xs rounded font-medium transition ${
                        activeScratchpad === 'text' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Text Scratchpad
                    </button>
                    <button
                      onClick={() => setActiveScratchpad('draw')}
                      className={`px-3 py-1 text-xs rounded font-medium transition ${
                        activeScratchpad === 'draw' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Digital Canvas Drawing
                    </button>
                  </div>
                </div>

                {/* Render Text Mode */}
                {activeScratchpad === 'text' && (
                  <textarea
                    placeholder="Write down your variables: e.g. 100M bits/s * 0.08 s = 8M bits..."
                    value={scratchpadText}
                    onChange={(e) => setScratchpadText(e.target.value)}
                    rows={6}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-sm text-sky-300 focus:outline-none focus:border-sky-500"
                  />
                )}

                {/* Render Drawing Canvas Mode */}
                {activeScratchpad === 'draw' && (
                  <div className="space-y-2">
                    <div className="relative bg-slate-950 border border-slate-800 rounded-xl overflow-hidden cursor-crosshair">
                      <canvas
                        ref={canvasRef}
                        width={600}
                        height={240}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        className="w-full h-60 block"
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-400">
                      <span>Click and drag to draw calculations on the board. Works on desktops.</span>
                      <button 
                        onClick={clearCanvas}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded"
                      >
                        Clear Canvas
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}


          {/* TAB 3: QUIZ (SCENARIO TO OSI LAYER MATCHING) */}
          {activeTab === 'quiz' && (
            <div className="space-y-6">
              
              {/* Quiz Introduction */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white mb-2">OSI Model Troubleshooting Scenario Match</h2>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Excellent diagnostics require mapping a physical symptom to the appropriate logical layer of the stack. Read the case details below and classify which layer governs the underlying issue!
                </p>
              </div>

              {/* Quiz Main Screen */}
              {!showQuizResult ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
                  
                  {/* Scenario Progress Header */}
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">
                      Scenario {activeScenarioIdx + 1} of {scenarios.length}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">
                      Score: <strong className="text-emerald-400 font-mono text-sm">{quizScore}</strong>
                    </span>
                  </div>

                  {/* Active Scenario Box */}
                  <div className="p-5 bg-slate-950 rounded-xl border border-slate-800/80 space-y-3">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                      {scenarios[activeScenarioIdx].title}
                    </h3>
                    <p className="text-sm text-slate-300 leading-relaxed italic">
                      "{scenarios[activeScenarioIdx].description}"
                    </p>
                  </div>

                  {/* Options Matrix (Layer 1 - Layer 7 Buttons) */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Select target classification layer:</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[
                        { num: 1, name: "Physical Layer (Layer 1)" },
                        { num: 2, name: "Data Link Layer (Layer 2)" },
                        { num: 3, name: "Network Layer (Layer 3)" },
                        { num: 4, name: "Transport Layer (Layer 4)" },
                        { num: 5, name: "Session Layer (Layer 5)" },
                        { num: 6, name: "Presentation Layer (Layer 6)" },
                        { num: 7, name: "Application Layer (Layer 7)" }
                      ].map((lyr) => {
                        const state = completedScenarios[scenarios[activeScenarioIdx].id];
                        const alreadyAnswered = !!state;
                        const isThisCorrect = lyr.num === scenarios[activeScenarioIdx].layer;
                        const selectedThis = state?.selected === lyr.num;

                        let btnStyle = "bg-slate-950 border-slate-800 text-slate-300 hover:border-sky-500 hover:text-white";
                        if (alreadyAnswered) {
                          if (isThisCorrect) {
                            btnStyle = "bg-emerald-500/10 border-emerald-500 text-emerald-400";
                          } else if (selectedThis) {
                            btnStyle = "bg-rose-500/10 border-rose-500 text-rose-400";
                          } else {
                            btnStyle = "bg-slate-950 border-slate-900 text-slate-500 opacity-60";
                          }
                        }

                        return (
                          <button
                            key={lyr.num}
                            onClick={() => !alreadyAnswered && handleSelectLayer(lyr.num)}
                            disabled={alreadyAnswered}
                            className={`flex items-center justify-between p-3.5 rounded-xl border text-left text-xs font-semibold transition ${btnStyle}`}
                          >
                            <span>{lyr.name}</span>
                            {alreadyAnswered && isThisCorrect && (
                              <span className="text-emerald-400 text-[10px] uppercase font-bold">Correct</span>
                            )}
                            {alreadyAnswered && selectedThis && !isThisCorrect && (
                              <span className="text-rose-400 text-[10px] uppercase font-bold">Incorrect Choice</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Feedback Explanation */}
                  {completedScenarios[scenarios[activeScenarioIdx].id] && (
                    <div className="p-4 bg-slate-950 rounded-xl border border-indigo-950/40 text-xs text-slate-300 space-y-2">
                      <div className="font-bold text-sky-400">Diagnostic Explanation:</div>
                      <p className="leading-relaxed">
                        {scenarios[activeScenarioIdx].explanation}
                      </p>
                      <div className="pt-2 flex justify-end">
                        <button
                          onClick={handleNextScenario}
                          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-semibold transition"
                        >
                          {activeScenarioIdx < scenarios.length - 1 ? 'Next Scenario' : 'Finish Quiz'}
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-6">
                  <div className="inline-block p-4 bg-emerald-500/10 rounded-full border border-emerald-500/20 text-emerald-400 mb-2">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-white">Interactive Diagnostics Quiz Completed!</h3>
                  <p className="text-sm text-slate-300 max-w-md mx-auto">
                    You parsed the diagnostic scenarios correctly and scored <span className="font-bold text-sky-400 text-lg font-mono">{quizScore} / {scenarios.length}</span> points.
                  </p>
                  
                  <button
                    onClick={handleResetQuiz}
                    className="px-6 py-2 bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm rounded-lg transition"
                  >
                    Retake Scenario Quiz
                  </button>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Right Sidebar Columns: Active OSI Stack, AI Assistant & Classroom Sync */}
        <div className="space-y-6">
          
          {/* Firestore Scoreboard (Collaborative Sync Section) */}
          {db && user && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-2">
                Classroom Leaderboard
              </h3>
              
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Enter your name to register"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
                
                <button
                  onClick={syncScoreToCloud}
                  disabled={isSyncing || !studentName.trim()}
                  className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 flex justify-center items-center gap-1.5"
                >
                  {isSyncing ? (
                    <span className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : 'Sync My Score to Classroom'}
                </button>
              </div>

              {/* Leaderboard Table */}
              <div className="max-h-36 overflow-y-auto space-y-1 bg-slate-950/60 p-2 rounded-lg border border-slate-850">
                {studentRecords.length === 0 ? (
                  <div className="text-center text-slate-500 text-[10px] py-4">No logged scores yet. Be the first!</div>
                ) : (
                  studentRecords.map((rec, index) => (
                    <div key={rec.id} className="flex justify-between items-center text-[11px] p-1.5 rounded bg-slate-900/40 border border-slate-800/20">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono font-bold bg-slate-800 px-1 rounded text-slate-400">#{index+1}</span>
                        <span className="font-semibold text-slate-300 truncate max-w-[110px]">{rec.name}</span>
                      </div>
                      <span className="font-mono text-emerald-400 font-bold">{rec.score} pts</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* OSI Model Quick reference stack */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">
              OSI Layer Reference
            </h3>
            
            <div className="space-y-1.5">
              {[
                { l: "7", n: "Application", p: "HTTP, DNS, TLS", c: "bg-indigo-950/50 border-indigo-800/40" },
                { l: "6", n: "Presentation", p: "SSL, JSON, JPEG", c: "bg-indigo-950/30 border-indigo-800/30" },
                { l: "5", n: "Session", p: "NetBIOS, RPC sockets", c: "bg-slate-900 border-slate-800/50" },
                { l: "4", n: "Transport", p: "TCP, UDP (Ports)", c: "bg-sky-950/40 border-sky-800/40 text-sky-300" },
                { l: "3", n: "Network", p: "IP, ICMP, Routing", c: "bg-sky-950/20 border-sky-800/20 text-sky-300" },
                { l: "2", n: "Data Link", p: "Ethernet, MAC, VLANs", c: "bg-slate-900 border-slate-800/50" },
                { l: "1", n: "Physical", p: "Fiber optic, Bits, RJ-45", c: "bg-slate-950 border-slate-900" }
              ].map((layer) => (
                <div 
                  key={layer.l}
                  className={`p-2.5 rounded-lg border text-xs flex justify-between items-center transition hover:bg-slate-800/50 cursor-help ${layer.c}`}
                  title={`Focus Protocols: ${layer.p}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono bg-slate-950/80 px-2 py-0.5 rounded text-[10px] border border-slate-800">
                      L{layer.l}
                    </span>
                    <span className="font-bold">{layer.n}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{layer.p}</span>
                </div>
              ))}
            </div>
            
            <p className="text-[10px] text-slate-400 leading-relaxed text-center">
              Hover layers to highlight diagnostic protocols.
            </p>
          </div>

          {/* AI Network Diagnostics Instructor Companion */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col h-[320px]">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-3">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">AI Troubleshooting Instructor</h3>
                <span className="text-[9px] text-emerald-400 font-semibold uppercase tracking-wider">Powered by Gemini AI</span>
              </div>
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
            </div>

            {/* Chat Box Area */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs max-h-48 scrollbar-thin">
              {chatHistory.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={`p-2.5 rounded-xl leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-sky-500/10 border border-sky-500/20 text-sky-200 ml-4' 
                      : 'bg-slate-950 border border-slate-800 text-slate-300 mr-4'
                  }`}
                >
                  <div className="font-bold uppercase text-[9px] mb-1 text-slate-400">
                    {msg.role === 'user' ? 'You (Student)' : 'AI Instructor'}
                  </div>
                  <p>{msg.text}</p>
                </div>
              ))}
              {isAiLoading && (
                <div className="text-slate-400 text-[11px] animate-pulse">
                  AI Instructor is thinking...
                </div>
              )}
              {aiError && (
                <div className="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] rounded">
                  {aiError}
                </div>
              )}
            </div>

            {/* Form Input Area */}
            <div className="mt-3 pt-3 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                placeholder="Ask about TCP windows, RTT, or physical limits..."
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && callNetworkAI()}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 flex-1"
              />
              <button
                onClick={callNetworkAI}
                disabled={isAiLoading}
                className="bg-sky-500 hover:bg-sky-400 text-white px-3 rounded-lg text-xs font-bold transition disabled:opacity-50"
              >
                Ask
              </button>
            </div>
          </div>

        </div>

      </main>

      {/* Footer Info */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center flex flex-col md:flex-row justify-between items-center gap-3">
          <p className="text-xs text-slate-500">
            © 2026 Interactive Network Performance and Diagnostics Sandbox. All calculations adhere to standard IEEE/IETF formulas.
          </p>
          <div className="flex gap-4 text-xs text-slate-400">
            <span className="hover:text-white cursor-pointer">Troubleshooting Guidelines</span>
            <span>•</span>
            <span className="hover:text-white cursor-pointer">BDP Reference</span>
          </div>
        </div>
      </footer>
    </div>
  );
}