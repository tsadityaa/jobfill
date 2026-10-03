import Supermemory from 'supermemory';

// Initialize the Supermemory client
// We get the API key from Vite's env variables
const client = new Supermemory({
  apiKey: import.meta.env.VITE_SUPERMEMORY_API_KEY || 'MISSING_API_KEY',
});

/**
 * Add a memory for a specific user
 * @param userId The Supabase user ID (acts as the isolation boundary)
 * @param content The text/memory to store
 * @param metadata Optional key/value pairs to filter by
 */
export async function addMemory(userId: string, content: string, metadata?: Record<string, string>) {
  if (!import.meta.env.VITE_SUPERMEMORY_API_KEY) {
    console.warn('Supermemory API Key missing. Memory not saved.');
    return;
  }
  
  try {
    await client.add({
      content,
      containerTag: userId,
      metadata,
    });
    console.log('[Supermemory] Memory added successfully');
  } catch (error) {
    console.error('[Supermemory] Failed to add memory:', error);
  }
}

/**
 * Search a specific user's memories
 * @param userId The Supabase user ID
 * @param query The question or search term
 * @returns Array of matching memories
 */
export async function searchMemory(userId: string, query: string): Promise<string[]> {
  if (!import.meta.env.VITE_SUPERMEMORY_API_KEY) {
    return [];
  }

  try {
    const response = await client.search({
      q: query,
      containerTag: userId,
      // @ts-ignore - explicitly ask for hybrid search to catch both memories and document chunks
      searchMode: 'hybrid',
      limit: 5,
    });
    
    // Supermemory search usually returns an array of result objects
    // We'll extract just the raw text content for the agent to read
    if (response && response.results) {
      console.log('[Supermemory] Raw search results:', response.results);
      // @ts-ignore - The types might be slightly different depending on SDK version
      return response.results.map(r => r.memory || r.chunk || JSON.stringify(r));
    }
    return [];
  } catch (error) {
    console.error('[Supermemory] Search failed:', error);
    return [];
  }
}

/**
 * Get an AI-generated profile summary of the user from their memories
 */
export async function getMemoryProfile(userId: string): Promise<string> {
  if (!import.meta.env.VITE_SUPERMEMORY_API_KEY) {
    return '';
  }

  try {
    const response = await client.profile({
      containerTag: userId,
    });
    
    // @ts-ignore
    return response.profile || '';
  } catch (error) {
    console.error('[Supermemory] Profile fetch failed:', error);
    return '';
  }
}
