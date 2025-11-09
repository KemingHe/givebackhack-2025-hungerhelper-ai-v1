import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { pantryData } from '../data/pantryData';
import { GroundingSource } from '../types';

// IMPORTANT: Do not expose this key publicly.
// It is assumed that process.env.API_KEY is configured in the build environment.
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export type GenerateMode = 'grounded' | 'thinking' | 'standard';

const parseGroundingSources = (response: GenerateContentResponse): GroundingSource[] => {
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (!groundingChunks) return [];

    const sources: GroundingSource[] = [];
    groundingChunks.forEach(chunk => {
        if (chunk.web) {
            sources.push({ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri, type: 'web' });
        } else if (chunk.maps) {
            sources.push({ uri: chunk.maps.uri, title: chunk.maps.title || 'Map View', type: 'maps' });
        }
    });
    return sources;
};

const getFullPrompt = (prompt: string, location: GeolocationCoordinates | null) => {
    const pantryDataContext = `Here is a list of known food resources:\n${JSON.stringify(pantryData, null, 2)}`;
    return `You are HungerHelper, an AI assistant for people in need of food. Your primary goal is to help users find the closest and most accessible food pantries or meal services based on a trusted, internal list of providers.

Current time: ${new Date().toLocaleString()}
User's location: ${location ? `Latitude: ${location.latitude}, Longitude: ${location.longitude}` : 'Unknown, please ask the user for their location.'}

**IMPORTANT INSTRUCTIONS:**
1.  **Prioritize this list**: Your primary source of information is the following list of trusted food resources. Always check this list first and recommend options from it if they match the user's needs.
    \n${pantryDataContext}\n
2.  **Analyze the user's request**: Understand what the user is asking for. They are looking for food assistance. The query is: "${prompt}".
3.  **Use tools for verification only**: You can use Google Maps and Google Search, but ONLY to verify or supplement information about the pantries from the list above (e.g., confirm current opening hours, check for holiday closures, or find a phone number if it's missing). Do NOT use web search to find new, unlisted pantries, as those results can be unreliable.
4.  **Provide a helpful response**: Give a clear, concise, and empathetic answer. Recommend the best option(s) from the provided list based on proximity and current availability. Include the name, address, hours, and any important notes from the list. If you used a tool to verify information, mention that.
5.  **Be supportive**: Maintain a friendly and supportive tone throughout the conversation.`;
};


export const generateResponse = async (
    prompt: string, 
    mode: 'grounded' | 'standard', 
    location: GeolocationCoordinates | null
): Promise<{ text: string, sources: GroundingSource[] }> => {
    const fullPrompt = getFullPrompt(prompt, location);
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: mode === 'standard' ? prompt : fullPrompt,
            config: mode === 'grounded' ? {
                tools: [{ googleSearch: {} }, { googleMaps: {} }],
                ...(location ? {
                    toolConfig: {
                        retrievalConfig: {
                            latLng: {
                                latitude: location.latitude,
                                longitude: location.longitude,
                            },
                        },
                    },
                } : {})
            } : {}
        });
        
        const text = response.text;
        const sources = parseGroundingSources(response);
        return { text, sources };

    } catch (error) {
        console.error("Error generating response from Gemini:", error);
        return { text: "I'm sorry, I encountered an error while processing your request. Please try again later.", sources: [] };
    }
};

export const generateResponseStream = async (
    prompt: string,
    location: GeolocationCoordinates | null,
    onChunk: (chunk: { text?: string; step?: string; sources?: GroundingSource[] }) => void
): Promise<{ text: string, sources: GroundingSource[] }> => {
    const fullPrompt = getFullPrompt(prompt, location);
    try {
        const stream = await ai.models.generateContentStream({
            model: 'gemini-2.5-pro',
            contents: fullPrompt,
            config: {
                tools: [{ googleSearch: {} }, { googleMaps: {} }],
                ...(location ? {
                    toolConfig: {
                        retrievalConfig: {
                            latLng: {
                                latitude: location.latitude,
                                longitude: location.longitude,
                            },
                        },
                    },
                } : {})
            }
        });

        let fullText = "";
        let finalResponse: GenerateContentResponse | undefined;

        for await (const chunk of stream) {
            finalResponse = chunk;
            if (chunk.text) {
                const text = chunk.text;
                fullText += text;
                onChunk({ text });
            }
            // FIX: Replaced incorrect functionCalls check with groundingMetadata check to detect tool usage.
            const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks) {
                if (groundingChunks.some(c => c.web)) {
                    onChunk?.({step: 'Searching the web for latest info...'})
                }
                if (groundingChunks.some(c => c.maps)) {
                    onChunk?.({step: 'Checking locations and routes...'})
                }
            }
        }
        
        const sources = parseGroundingSources(finalResponse);
        onChunk({ sources });
        return { text: fullText, sources };

    } catch (error) {
        console.error("Error generating streaming response from Gemini:", error);
        return { text: "I'm sorry, I encountered an error while processing your request. Please try again later.", sources: [] };
    }
}


export const getSpeechAudio = async (text: string): Promise<string | null> => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return base64Audio || null;
    } catch (error) {
        console.error("Error generating speech from Gemini:", error);
        return null;
    }
};