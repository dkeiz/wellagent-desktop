const fs = require('fs');
const path = require('path');
const { resolveModelSpec } = require('../../src/main/llm-config');

module.exports = {
  name: 'llm-provider-spec-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const specPath = path.join(rootDir, 'src', 'main', 'llm-model-specs.json');
    const llmConfigPath = path.join(rootDir, 'src', 'main', 'llm-config.js');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const llmConfigSource = fs.readFileSync(llmConfigPath, 'utf8');

    ['openai', 'groq', 'deepseek', 'mistral', 'anthropic', 'byok', 'local-openai'].forEach(providerId => {
      assert.ok(spec.providers[providerId], `Expected provider registry entry for ${providerId}`);
    });

    assert.equal(spec.providers.openai.label, 'OpenAI', 'Expected OpenAI provider label to stay concise in the selector');
    assert.includes(
      spec.providers.openai.description,
      'Codex CLI subscription mode or OpenAI API key mode',
      'Expected OpenAI provider description to cover both supported transports'
    );
    assert.ok(
      spec.providers.openai.settings.connectionFields.some(field => field.id === 'apiKey'),
      'Expected OpenAI provider to require an API key field'
    );
    assert.ok(
      spec.providers.byok.settings.connectionFields.some(field => field.id === 'url'),
      'Expected BYOK provider to expose a base URL field'
    );
    assert.equal(
      spec.providers['local-openai'].settings.supportsRequestOverrides,
      true,
      'Expected local OpenAI-compatible provider to allow request overrides'
    );

    const gpt52Family = spec.providers.openai.models.find(model => model.id === 'openai-gpt-5.2');
    assert.equal(
      gpt52Family.capabilities.reasoning.parameterMode,
      'openai_reasoning_effort',
      'Expected GPT-5.2 family to map reasoning effort through the OpenAI parameter'
    );

    const lmstudioReasoning = spec.providers.lmstudio.models.find(model => model.id === 'lmstudio-generic-reasoning');
    const byokReasoning = spec.providers.byok.models.find(model => model.id === 'byok-generic-reasoning');
    const localReasoning = spec.providers['local-openai'].models.find(model => model.id === 'local-openai-generic-reasoning');
    [lmstudioReasoning, byokReasoning, localReasoning].forEach((family, index) => {
      assert.ok(Array.isArray(family.match), `Expected reasoning family ${index} to expose model match aliases`);
      assert.ok(
        family.match.includes('openai/gpt-oss-*'),
        'Expected generic reasoning families to match openai/gpt-oss-* aliases'
      );
    });

    const lmstudioResolved = resolveModelSpec('lmstudio', 'openai/gpt-oss-120b:cloud');
    assert.equal(
      lmstudioResolved.capabilities.reasoning.supported,
      true,
      'Expected LM Studio aliases like openai/gpt-oss-120b:cloud to resolve to reasoning-capable family'
    );

    const byokResolved = resolveModelSpec('byok', 'provider/openai/gpt-oss-120b');
    assert.equal(
      byokResolved.capabilities.reasoning.supported,
      true,
      'Expected BYOK prefixed GPT-OSS aliases to resolve to reasoning-capable family'
    );

    assert.includes(llmConfigSource, 'async function getProviderConnectionConfig', 'Expected provider connection config loader in llm-config');
    assert.includes(llmConfigSource, 'async function saveProviderConnectionConfig', 'Expected provider connection config saver in llm-config');
    assert.includes(llmConfigSource, 'function getProviderCatalogModels', 'Expected catalog model helper in llm-config');
  }
};
