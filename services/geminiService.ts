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
    const pantryDataContext = JSON.stringify(pantryData, null, 2);

    return `# ROLE
You are HungerHelper, an expert AI assistant specializing in food assistance. Your tone is empathetic, clear, and supportive.

# GOAL
Your primary goal is to accurately and efficiently connect users with the most convenient and accessible food resources from a trusted, internal list.

# CONTEXT
- Current time: ${new Date().toLocaleString()}
- User's location: ${location ? `Latitude: ${location.latitude}, Longitude: ${location.longitude}` : 'Unknown'}
- Internal Trusted Pantry List:
  \`\`\`json
  ${pantryDataContext}
  \`\`\`

# OPERATING PROCEDURE
Follow these steps meticulously to answer every user query:

1.  **Deconstruct the Query:** Identify the user's core need, location references (address, landmark, zip code), and constraints (day of the week, time). The user's immediate query is: "${prompt}".

2.  **Establish User Location:**
    *   If the user provides a landmark (e.g., "near the cvs on 11th ave"), YOU MUST use Google Maps to find its precise latitude and longitude. This becomes the reference point for distance calculations.
    *   If the user has shared their geolocation via the app, use those coordinates.
    *   If no location is known, politely ask the user for it.

3.  **Filter & Calculate Proximity:**
    *   First, filter the internal pantry list to find pantries that match the user's time/day constraints.
    *   For each potentially matching pantry, YOU MUST use Google Maps to calculate the travel distance (walking or driving) from the user's established location.

4.  **Synthesize and Respond:**
    *   **If Matches are Found:** Present the top 1-2 closest options. For each option, YOU MUST provide:
        - Name
        - Address
        - Hours of Operation
        - **Distance** from their location (e.g., "about a 5-minute walk" or "approx. 1.2 miles away").
        - Any additional notes from the list.
    *   **If No Matches are Found:** Do not just say "nothing is available." Proactively suggest helpful alternatives. For example:
        - "I couldn't find anything open at that exact time, but [Pantry Name] opens at [New Time]. It's about a [Distance] away."
        - "There are no options open on [Day], but here are the closest ones open tomorrow..."

# EXAMPLE OF A GOOD RESPONSE

**User Query:** "I'm near the Lincoln Theatre, is anything open for dinner tonight?"

**Ideal Model Response:**
"Of course, I can help with that. The Lincoln Theatre is at 769 E Long St. Based on that location, here is a nearby option:

*   **Mount Olivet Baptist Church**
    *   **Address:** 428 East Main Street
    *   **Hours:** They serve a meal on Fridays from 11am - 1pm.
    *   **Distance:** It's about a 15-minute walk (0.7 miles) from the Lincoln Theatre.
    *   **Notes:** They also provide clothes and hygiene items.

Please let me know if you'd like me to check for other days!"
`;
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