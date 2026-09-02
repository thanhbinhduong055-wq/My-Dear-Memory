// Stand-in for localforage backed by IndexedDB-ish async storage.
(function(){
  const mem = new Map();
  window.localforage = {
    driver: () => 'asyncStorage',
    LOCALSTORAGE: 'localStorageWrapper',
    async getItem(k){ await new Promise(r=>setTimeout(r,5)); return mem.has(k)?mem.get(k):null; },
    async setItem(k,v){ await new Promise(r=>setTimeout(r,5)); mem.set(k,v); return v; },
    async removeItem(k){ await new Promise(r=>setTimeout(r,5)); mem.delete(k); },
  };
})();
