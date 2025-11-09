import React from 'react';
import { Message, Role, GroundingSource } from '../types';
import { SoundIcon, StopIcon, UserIcon, BotIcon, WebIcon, MapIcon, CheckIcon, SpinnerIcon } from './Icons';

interface MessageBubbleProps {
    message: Message;
    onAudioRequest: (message: Message) => void;
}

const SourceLink: React.FC<{ source: GroundingSource }> = ({ source }) => (
    <a
        href={source.uri}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 bg-gray-600 hover:bg-gray-500 text-xs text-gray-200 px-2 py-1 rounded-full transition-colors truncate"
        title={source.title}
    >
        {source.type === 'maps' ? <MapIcon /> : <WebIcon />}
        <span className="truncate">{source.title || new URL(source.uri).hostname}</span>
    </a>
);

const ThinkingIndicator: React.FC<{ steps: string[] }> = ({ steps }) => (
    <div className="mb-3 border-b border-gray-600 pb-3">
        <h4 className="text-sm font-semibold text-gray-300 mb-2">Assistant is thinking...</h4>
        <ul className="space-y-1.5">
            {steps.map((step, index) => (
                <li key={index} className="flex items-center gap-2 text-xs text-gray-400 animate-fade-in">
                    {index < steps.length - 1 ? (
                        <CheckIcon />
                    ) : (
                        <SpinnerIcon />
                    )}
                    <span>{step}</span>
                </li>
            ))}
        </ul>
    </div>
);


const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onAudioRequest }) => {
    const isUser = message.role === Role.USER;

    const formattedText = message.text.split('\n').map((line, index) => (
        <React.Fragment key={index}>
            {line}
            <br />
        </React.Fragment>
    ));

    return (
        <div className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {!isUser && (
                <div className="w-8 h-8 rounded-full bg-emerald-500 flex-shrink-0 flex items-center justify-center">
                    <BotIcon />
                </div>
            )}
            
            <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                <div
                    className={`rounded-2xl p-4 max-w-lg md:max-w-xl shadow-md ${
                        isUser
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-gray-700 text-gray-200 rounded-bl-none'
                    }`}
                >
                    {message.isThinking && message.thinkingSteps && <ThinkingIndicator steps={message.thinkingSteps} />}

                    <p className="whitespace-pre-wrap">{!message.text && message.isThinking ? "Please wait..." : formattedText}</p>
                    
                    {!isUser && !message.isThinking && message.text && (
                        <div className="mt-3 flex items-center justify-between">
                            <button
                                onClick={() => onAudioRequest(message)}
                                className="text-gray-400 hover:text-white transition-colors"
                                title={message.isPlayingAudio ? "Stop reading" : "Read aloud"}
                            >
                                {message.isPlayingAudio ? <StopIcon /> : <SoundIcon />}
                            </button>
                        </div>
                    )}
                </div>

                {message.sources && message.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 max-w-lg md:max-w-xl">
                        {message.sources.map((source, index) => (
                            <SourceLink key={index} source={source} />
                        ))}
                    </div>
                )}
            </div>

            {isUser && (
                <div className="w-8 h-8 rounded-full bg-blue-600 flex-shrink-0 flex items-center justify-center">
                    <UserIcon />
                </div>
            )}
        </div>
    );
};

export default MessageBubble;