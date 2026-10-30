// Public renderer API. Errors are constructed after crossing contextBridge so codes survive.
export function createAtlasClient(bridge) {
  async function invoke(method, payload) {
    const result = await bridge[method](payload);
    if (result.ok) return result.value;
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return {
    getRegions: () => invoke('getRegions'),
    getMap: (request) => invoke('getMap', request),
    saveImage: (payload) => invoke('saveImage', payload),
  };
}
