const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'network-policy-wrapper-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const networkPolicy = fs.readFileSync(path.join(rootDir, 'src', 'main', 'network-policy.js'), 'utf8');
    assert.includes(networkPolicy, 'function externalWebFetch', 'Expected explicit external web fetch helper');
    assert.includes(networkPolicy, 'function localProbeFetch', 'Expected explicit local probe fetch helper');
    assert.includes(networkPolicy, 'function localProbeAxiosRequest', 'Expected explicit local probe axios helper');

    const embedding = fs.readFileSync(path.join(rootDir, 'src', 'main', 'embedding-service.js'), 'utf8');
    assert.ok(!embedding.includes('axios.post('), 'Expected embedding service not to call axios.post directly');
    assert.ok(!embedding.includes('axios.get('), 'Expected embedding service not to call axios.get directly');
    assert.includes(embedding, 'localProbeAxiosRequest', 'Expected embedding service to use local probe axios policy');

    const ollama = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ollama-service.js'), 'utf8');
    assert.includes(ollama, 'localProbeFetch', 'Expected Ollama service to use local probe fetch policy');
    assert.ok(!ollama.includes("require('node-fetch')"), 'Expected Ollama service not to import fetch directly');

    const sessionInit = fs.readFileSync(path.join(rootDir, 'src', 'main', 'session-init-manager.js'), 'utf8');
    assert.ok(!sessionInit.includes('http.get('), 'Expected session init probes not to call http.get directly');
    assert.includes(sessionInit, 'externalWebFetch', 'Expected internet probe to use external web policy');
    assert.includes(sessionInit, 'localProbeFetch', 'Expected local provider probe to use local probe policy');

    const a2a = fs.readFileSync(path.join(rootDir, 'src', 'main', 'a2a-target-executor.js'), 'utf8');
    assert.includes(a2a, 'externalWebFetch', 'Expected A2A target executor to use external web policy');
    assert.includes(a2a, 'assertNetworkPolicyUrl', 'Expected A2A stream path to assert network URL policy');
    assert.ok(!a2a.includes("require('node-fetch')"), 'Expected A2A target executor not to import fetch directly');
  }
};
