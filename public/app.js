const state = {
  taggerResult: null
};

const elements = {
  selectedFileName: document.querySelector('#selectedFileName'),
  taggerImage: document.querySelector('#taggerImage'),
  generalThreshold: document.querySelector('#generalThreshold'),
  characterThreshold: document.querySelector('#characterThreshold'),
  extractTagsButton: document.querySelector('#extractTagsButton'),
  applyPromptButton: document.querySelector('#applyPromptButton'),
  appendPromptButton: document.querySelector('#appendPromptButton'),
  taggerStatus: document.querySelector('#taggerStatus'),
  promptTagsOutput: document.querySelector('#promptTagsOutput'),
  rawTagsOutput: document.querySelector('#rawTagsOutput'),
  toggleRawTagsButton: document.querySelector('#toggleRawTagsButton'),
  analysisMeta: document.querySelector('#analysisMeta'),
  promptTextarea: document.querySelector('#promptTextarea'),
  negativeTextarea: document.querySelector('#negativeTextarea'),
  styleSelect: document.querySelector('#styleSelect'),
  modelSelect: document.querySelector('#modelSelect'),
  seedInput: document.querySelector('#seedInput'),
  generateButton: document.querySelector('#generateButton'),
  generateStatus: document.querySelector('#generateStatus'),
  previewImage: document.querySelector('#previewImage'),
  imageMeta: document.querySelector('#imageMeta')
};

function setStatus(element, text, tone = 'info') {
  element.textContent = text;
  element.dataset.tone = tone;
}

function setButtonsEnabled(enabled) {
  elements.applyPromptButton.disabled = !enabled;
  elements.appendPromptButton.disabled = !enabled;
}

function updateFileName() {
  const file = elements.taggerImage.files?.[0];
  elements.selectedFileName.textContent = file ? file.name : 'png, jpg, jpeg, webp';
}

function fillSelect(select, values, fallback) {
  select.innerHTML = '';

  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }

  if (fallback && values.includes(fallback)) {
    select.value = fallback;
  }
}

function renderAnalysisMeta(result) {
  const rating = (result.rating || []).slice(0, 2).map((item) => `${item.tag} ${Number(item.score).toFixed(2)}`).join(', ') || '(없음)';
  const characterCount = (result.character || []).length;
  const generalCount = (result.general || []).length;

  elements.analysisMeta.innerHTML = `
    <div class="meta-chip">
      <strong>Rating</strong>
      <span>${rating}</span>
    </div>
    <div class="meta-chip">
      <strong>General Tags</strong>
      <span>${generalCount}개</span>
    </div>
    <div class="meta-chip">
      <strong>Character Tags</strong>
      <span>${characterCount}개</span>
    </div>
  `;
}

function applyPrompt(mode) {
  if (!state.taggerResult?.promptTags) {
    return;
  }

  if (mode === 'replace') {
    elements.promptTextarea.value = state.taggerResult.promptTags;
    return;
  }

  const current = elements.promptTextarea.value.trim();
  elements.promptTextarea.value = current
    ? `${current}, ${state.taggerResult.promptTags}`
    : state.taggerResult.promptTags;
}

async function loadMeta() {
  const response = await fetch('/api/meta');
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || '메타 정보를 불러오지 못했어.');
  }

  fillSelect(elements.styleSelect, data.styleChoices || [], data.defaultStyle);
  fillSelect(elements.modelSelect, data.modelChoices || [], data.defaultModel);
  elements.negativeTextarea.value = data.defaultNegative || '';
}

async function extractTags() {
  const file = elements.taggerImage.files?.[0];

  if (!file) {
    setStatus(elements.taggerStatus, '먼저 이미지를 올려줘.', 'error');
    return;
  }

  const formData = new FormData();
  formData.set('image', file);
  formData.set('generalThreshold', elements.generalThreshold.value);
  formData.set('characterThreshold', elements.characterThreshold.value);

  setStatus(elements.taggerStatus, 'WD14 분석 중이야. 첫 실행은 모델 다운로드 때문에 오래 걸릴 수 있어.', 'info');
  elements.extractTagsButton.disabled = true;

  try {
    const response = await fetch('/api/tagger', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    state.taggerResult = data;
    elements.promptTagsOutput.textContent = data.promptTags || '(없음)';
    elements.rawTagsOutput.textContent = data.rawTags || '(없음)';
    elements.rawTagsOutput.hidden = true;
    setButtonsEnabled(Boolean(data.promptTags));
    renderAnalysisMeta(data);
    setStatus(elements.taggerStatus, '태그 추출이 끝났어. 프롬프트에 바로 넣을 수 있어.', 'success');
  } catch (error) {
    state.taggerResult = null;
    setButtonsEnabled(false);
    setStatus(elements.taggerStatus, error instanceof Error ? error.message : String(error), 'error');
  } finally {
    elements.extractTagsButton.disabled = false;
  }
}

async function generateImage() {
  const payload = {
    prompt: elements.promptTextarea.value,
    negative: elements.negativeTextarea.value,
    style: elements.styleSelect.value,
    model: elements.modelSelect.value,
    seed: elements.seedInput.value
  };

  setStatus(elements.generateStatus, '이미지 생성 요청을 보냈어. ComfyUI 응답을 기다리는 중이야.', 'info');
  elements.generateButton.disabled = true;

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    elements.previewImage.src = `data:${data.mimeType};base64,${data.imageBase64}`;
    elements.previewImage.hidden = false;
    elements.imageMeta.textContent = `${data.model} / ${data.style}${data.promptPreset ? ` / preset:${data.promptPreset}` : ''}`;
    setStatus(elements.generateStatus, '이미지 생성이 완료됐어.', 'success');
  } catch (error) {
    setStatus(elements.generateStatus, error instanceof Error ? error.message : String(error), 'error');
  } finally {
    elements.generateButton.disabled = false;
  }
}

elements.taggerImage.addEventListener('change', updateFileName);
elements.extractTagsButton.addEventListener('click', extractTags);
elements.applyPromptButton.addEventListener('click', () => applyPrompt('replace'));
elements.appendPromptButton.addEventListener('click', () => applyPrompt('append'));
elements.generateButton.addEventListener('click', generateImage);
elements.toggleRawTagsButton.addEventListener('click', () => {
  const nextHidden = !elements.rawTagsOutput.hidden;
  elements.rawTagsOutput.hidden = nextHidden;
  elements.toggleRawTagsButton.textContent = nextHidden ? 'raw tags 보기' : 'raw tags 숨기기';
});

loadMeta().catch((error) => {
  setStatus(
    elements.generateStatus,
    error instanceof Error ? error.message : String(error),
    'error'
  );
});
