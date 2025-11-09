import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, Role, GroundingSource } from '../types';
import { getSpeechAudio, generateResponseStream } from '../services/geminiService';
import { useGeolocation } from '../hooks/useGeolocation';
import MessageBubble from './MessageBubble';
import { BrainIcon, GeoIcon, MicIcon, SendIcon } from './Icons';

// Audio decoding utilities
const decode = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// FIX: Updated audio decoding to be more robust and align with documentation.
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


const Chat: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([
        { id: 'initial', text: "Hello! I'm HungerHelper. I can help you find food pantries near you. To get started, please share your location or tell me your address or zip code.", role: Role.MODEL }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const { location, error: geoError, getLocation, loading: geoLoading } = useGeolocation();
    const chatEndRef = useRef<HTMLDivElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const recognitionRef = useRef<any | null>(null); // Using `any` for SpeechRecognition for cross-browser compatibility

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (location) {
            setMessages(prev => [...prev, { id: 'location-info', text: "Thank you! I've got your location. How can I help you find food today?", role: Role.MODEL }]);
        } else if (geoError) {
             setMessages(prev => [...prev, { id: 'location-error', text: `I couldn't get your location automatically. Error: ${geoError.message}. Please enter your address or zip code.`, role: Role.MODEL }]);
        }
    }, [location, geoError]);

     useEffect(() => {
        // FIX: Cast window to any to access non-standard SpeechRecognition properties.
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
                 setInput(finalTranscript + interimTranscript);
            };
            recognition.onstart = () => setIsRecording(true);
            recognition.onend = () => setIsRecording(false);
            recognition.onerror = (event) => console.error('Speech recognition error:', event.error);
            recognitionRef.current = recognition;
        }
    }, []);

    const handleMicClick = () => {
        if (isRecording) {
            recognitionRef.current?.stop();
        } else {
            recognitionRef.current?.start();
        }
    };


    const stopAudio = useCallback(() => {
        if (audioSourceRef.current) {
            audioSourceRef.current.stop();
            audioSourceRef.current = null;
        }
        setMessages(prev => prev.map(m => ({ ...m, isPlayingAudio: false })));
    }, []);

    const playAudio = async (messageId: string, audioDataB64: string) => {
        stopAudio();
        
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const context = audioContextRef.current;
        if (context.state === 'suspended') {
            await context.resume();
        }

        try {
            const decodedData = decode(audioDataB64);
            // FIX: Pass sample rate and channel count to the updated decodeAudioData function.
            const audioBuffer = await decodeAudioData(decodedData, context, 24000, 1);
            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(context.destination);
            source.onended = () => {
                setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isPlayingAudio: false } : m));
                audioSourceRef.current = null;
            };
            source.start();
            audioSourceRef.current = source;
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isPlayingAudio: true } : { ...m, isPlayingAudio: false }));
        } catch (e) {
            console.error('Error playing audio:', e);
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isPlayingAudio: false } : m));
        }
    };
    
    const handleAudioRequest = async (message: Message) => {
        if (message.isPlayingAudio) {
            stopAudio();
            return;
        }
    
        if (message.audioData) {
            await playAudio(message.id, message.audioData);
            return;
        }
    
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isGeneratingAudio: true } : m));
    
        const audioData = await getSpeechAudio(message.text);
    
        if (audioData) {
            setMessages(prev => prev.map(m => 
                m.id === message.id 
                ? { ...m, audioData, isGeneratingAudio: false } 
                : m
            ));
            await playAudio(message.id, audioData);
        } else {
            // On failure, just reset the loading state
            setMessages(prev => prev.map(m => 
                m.id === message.id 
                ? { ...m, isGeneratingAudio: false } 
                : m
            ));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const newUserMessage: Message = { id: Date.now().toString(), text: input, role: Role.USER };
        setMessages(prev => [...prev, newUserMessage]);
        setInput('');
        setIsLoading(true);

        const modelMessageId = (Date.now() + 1).toString();
        const thinkingMessage: Message = {
            id: modelMessageId,
            text: '',
            role: Role.MODEL,
            isThinking: true,
            thinkingSteps: ['Analyzing your request...', 'Consulting internal pantry list...']
        };
        setMessages(prev => [...prev, thinkingMessage]);

        const handleChunk = (chunk: { text?: string; step?: string; sources?: GroundingSource[] }) => {
            setMessages(prev => prev.map(msg => {
                if (msg.id !== modelMessageId || !msg.isThinking) return msg;
                
                const updatedMsg = { ...msg, thinkingSteps: [...(msg.thinkingSteps || [])] };
                if (chunk.text) updatedMsg.text += chunk.text;
                if (chunk.step && !updatedMsg.thinkingSteps.includes(chunk.step)) {
                    updatedMsg.thinkingSteps.push(chunk.step);
                }
                if (chunk.sources) updatedMsg.sources = chunk.sources;
                return updatedMsg;
            }));
        };

        const { text, sources } = await generateResponseStream(newUserMessage.text, location, handleChunk);
        
        setMessages(prev => prev.map(msg => 
            msg.id === modelMessageId 
            ? { ...msg, text, sources, isThinking: false, thinkingSteps: [...(msg.thinkingSteps || []), 'Formatting the response...'] } 
            : msg
        ));
        
        setIsLoading(false);
    };

    return (
        <div className="w-full max-w-4xl h-[80vh] flex flex-col bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
            <div className="flex-grow p-6 space-y-6 overflow-y-auto">
                {messages.map(msg => (
                    <MessageBubble key={msg.id} message={msg} onAudioRequest={handleAudioRequest} />
                ))}
                <div ref={chatEndRef} />
            </div>
            <div className="p-4 bg-gray-800 border-t border-gray-700">
                <form onSubmit={handleSubmit} className="flex items-center gap-3">
                    <button 
                        type="button" 
                        onClick={getLocation} 
                        disabled={geoLoading}
                        title="Use my current location"
                        className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-colors ${location ? 'bg-emerald-500 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
                        {geoLoading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : <GeoIcon />}
                    </button>
                    <button
                        type="button"
                        onClick={handleMicClick}
                        title={isRecording ? "Stop listening" : "Listen for voice input"}
                        className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-700 hover:bg-gray-600'}`}
                    >
                        <MicIcon />
                    </button>
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask for food assistance..."
                        className="flex-grow p-3 bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white transition-shadow"
                    />
                    <button type="submit" disabled={!input.trim() || isLoading} className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-emerald-500 text-white rounded-full hover:bg-emerald-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors">
                        <SendIcon />
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Chat;