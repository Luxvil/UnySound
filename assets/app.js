(() => {
  const $ = selector => document.querySelector(selector);
  const rows = $('#vehicleRows');
  const panel = $('#workspacePanel');
  const toast = $('#toast');
  const classSelect = $('#audioClass');
  const audioSelect = $('#chosenAudio');
  const customAudio = $('#customAudio');
  let rootHandle = null;
  let items = [];
  let catalogVehicles = [];
  let fileHandles = new Map();
  let soundOffKeys = null;
  let selectedKeys = new Set();
  let customSounds = JSON.parse(localStorage.getItem('garageAudioCustomNames') || '[]');
  let audioDbPromise;
  let previewUrl = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validAudio = value => /^[A-Za-z0-9_]{1,64}$/.test(value);
  const classNames = {'Boats':'Barcos','Commercial':'Comerciais','Compacts':'Compactos','Coupes':'Cup\u00eas','Cycles':'Bicicletas','Emergency':'Emerg\u00eancia','Helicopters':'Helic\u00f3pteros','Industrial':'Industriais','Military':'Militares','Motorcycles':'Motocicletas','Muscle':'M\u00fasculos','Off-Road':'Fora de estrada','Open Wheel':'Rodas abertas','Planes':'Avi\u00f5es','Rail':'Trens','Sedans':'Sed\u00e3s','Service':'Servi\u00e7o','Sports':'Esportivos','Sports Classics':'Esportivos cl\u00e1ssicos','Super':'Superesportivos','SUVs':'SUVs','Utility':'Utilit\u00e1rios','Vans':'Vans','Tuners':'Preparados','Remote Control':'Controle remoto'};

  function notify(message, error = false) {
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  async function scanFolder(root) {
    const found = [];
    const handles = new Map();
    const pending = [{directory:root, prefix:''}];
    while (pending.length) {
      const {directory, prefix} = pending.pop();
      for await (const [name, entry] of directory.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'directory') {
          pending.push({directory:entry, prefix:path});
          continue;
        }
        if (entry.kind !== 'file' || name.toLowerCase() !== 'vehicles.meta') continue;
        const fileHandle = entry;
        const source = await (await fileHandle.getFile()).text();
        handles.set(path, fileHandle);
        const blocks = [...source.matchAll(/<Item\b[^>]*>[\s\S]*?<\/Item>/gi)];
        blocks.forEach((match, index) => {
          const model = /<modelName\b[^>]*>([\s\S]*?)<\/modelName>/i.exec(match[0]);
          if (!model) return;
          const audio = /<audioNameHash\b[^>]*>([\s\S]*?)<\/audioNameHash>/i.exec(match[0]);
          const vehicleClass = /<vehicleClass\b[^>]*>([\s\S]*?)<\/vehicleClass>/i.exec(match[0]);
          const clean = value => value ? value[1].replace(/<[^>]*>/g, '').trim() : '';
          found.push({key:`${path}::${index}`,path,index,model:clean(model),audio:clean(audio),vehicleClass:clean(vehicleClass) || 'SEM_CLASSE'});
        });
      }
    }
    return {items:found,handles};
  }

  function fillAudioCatalog() {
    const classes = [...new Set(catalogVehicles.flatMap(vehicle => vehicle.categories))].sort((a,b) => a.localeCompare(b));
    classSelect.innerHTML = '<option value="all">Todas as classes</option>' + classes.map(value => `<option value="${esc(value)}">${esc(classNames[value] || value)}</option>`).join('') + '<option value="custom">Personalizados</option>';
    classSelect.disabled = false;
    populateAudios();
  }

  function populateAudios() {
    const selectedClass = classSelect.value || 'all';
    const available = selectedClass === 'custom' ? [] : catalogVehicles.filter(vehicle => selectedClass === 'all' || vehicle.categories.includes(selectedClass));
    const options = available.map((vehicle, index) => `<option value="vehicle:${catalogVehicles.indexOf(vehicle)}">${esc(vehicle.name)} (${esc(vehicle.audio)})</option>`);
    const currentAudios = [...new Set(items.map(item => item.audio).filter(Boolean))].filter(audio => !available.some(vehicle => vehicle.audio.toUpperCase() === audio.toUpperCase()));
    const currentOptions = currentAudios.map(audio => `<option value="${esc(audio)}">${esc(audio)} (\u00e1udio encontrado na pasta)</option>`);
    const customOptions = (selectedClass === 'all' || selectedClass === 'custom' ? customSounds : []).map(sound => `<option value="custom:${esc(sound.name)}">${esc(sound.name)} (personalizado)</option>`);
    audioSelect.innerHTML = '<option value="">Selecione um \u00e1udio</option>' + options.join('') + (currentOptions.length ? `<optgroup label="\u00c1udios encontrados na pasta">${currentOptions.join('')}</optgroup>` : '') + (customOptions.length ? `<optgroup label="Personalizados">${customOptions.join('')}</optgroup>` : '') + '<option value="__custom">Outro \u00e1udio (digitar)</option>';
    audioSelect.disabled = false;
    customAudio.classList.toggle('hidden', audioSelect.value !== '__custom');
    updateVehiclePreview();
  }

  function openAudioDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador n\u00e3o oferece armazenamento local de \u00e1udio.'));
    if (!audioDbPromise) audioDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('garage-audio-custom', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sounds', {keyPath:'name'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return audioDbPromise;
  }

  async function saveCustomSound(name, file) {
    const db = await openAudioDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sounds', 'readwrite');
      tx.objectStore('sounds').put({name, file, type:file.type});
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getCustomSound(name) {
    const db = await openAudioDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('sounds').objectStore('sounds').get(name);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function updateVehiclePreview() {
    const selectedValue = audioSelect.value;
    const vehicle = selectedValue.startsWith('vehicle:') ? catalogVehicles[Number(selectedValue.slice(8))] : null;
    const preview = $('#vehiclePreview');
    const audio = $('#audioPreview');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    audio.pause(); audio.removeAttribute('src'); audio.load(); audio.classList.add('hidden');
    if (vehicle) {
      $('#vehiclePreviewImage').src = vehicle.image || '';
      $('#vehiclePreviewImage').onerror = () => $('#vehiclePreviewImage').classList.add('hidden');
      $('#vehiclePreviewImage').classList.remove('hidden');
      $('#vehiclePreviewName').textContent = vehicle.name;
      $('#vehiclePreviewCategory').textContent = (vehicle.categories || []).map(category => classNames[category] || category).join(' \u00b7 ');
      $('#vehiclePreviewHash').textContent = `audioNameHash: ${vehicle.audio}`;
      preview.classList.remove('hidden');
    } else preview.classList.add('hidden');
    const customName = selectedValue.startsWith('custom:') ? selectedValue.slice(7) : '';
    const custom = customSounds.find(entry => entry.name.toLowerCase() === customName.toLowerCase());
    $('#audioPreviewHint').textContent = vehicle?.spawn ? 'Abra a pr\u00e9via interativa deste modelo para ouvir o motor.' : vehicle ? 'Pesquise este modelo no cat\u00e1logo do GTA Explorer para ouvir o motor.' : 'Pr\u00e9vias personalizadas tocam aqui.';
    const engineLink = $('#engineReference');
    engineLink.classList.toggle('hidden', !vehicle);
    if (vehicle) engineLink.href = vehicle.spawn ? `https://gta.mics.dev/vehicles/${encodeURIComponent(vehicle.spawn)}` : 'https://gta.mics.dev/vehicles';
    if (custom && custom.hasFile) getCustomSound(custom.name).then(record => {
      if (!record || audioSelect.value !== `custom:${custom.name}`) return;
      previewUrl = URL.createObjectURL(record.file);
      audio.src = previewUrl; audio.classList.remove('hidden'); $('#audioPreviewHint').textContent = `Pr\u00e9via: ${custom.name}`;
    }).catch(error => notify(error.message, true));
  }

  $('#registerCustomAudios').addEventListener('click', async () => {
    const names = $('#customAudioNames').value.split(/[\n,;]+/).map(name => name.trim()).filter(Boolean);
    const files = [...$('#customAudioFiles').files];
    const unique = [...new Set(names)];
    if (!unique.length && files.length) unique.push(...files.map(file => file.name.replace(/\.[^.]+$/, '')));
    if (!unique.length) return notify('Digite ao menos um nome de \u00e1udio ou selecione arquivos.', true);
    const invalid = unique.filter(name => !validAudio(name));
    if (invalid.length) return notify(`Nome inv\u00e1lido: ${invalid[0]}. Use letras, n\u00fameros e sublinhado, at\u00e9 64 caracteres.`, true);
    const byName = new Map(files.map(file => [file.name.replace(/\.[^.]+$/, '').toLowerCase(), file]));
    const additions = unique.map((name, index) => ({name, file:byName.get(name.toLowerCase()) || (unique.length === files.length ? files[index] : null)}));
    try {
      for (const entry of additions) if (entry.file) await saveCustomSound(entry.name, entry.file);
      const merged = new Map(customSounds.map(sound => [sound.name.toLowerCase(), sound]));
      additions.forEach(entry => merged.set(entry.name.toLowerCase(), {name:entry.name,hasFile:!!entry.file || !!merged.get(entry.name.toLowerCase())?.hasFile}));
      customSounds = [...merged.values()].sort((a,b) => a.name.localeCompare(b.name));
      localStorage.setItem('garageAudioCustomNames', JSON.stringify(customSounds));
      populateAudios();
      $('#customAudioStatus').textContent = `${additions.length} nome(s) cadastrado(s); ${additions.filter(entry => entry.file).length} amostra(s) salva(s) neste navegador.`;
      notify('\u00c1udios personalizados cadastrados.');
    } catch (error) { notify(`N\u00e3o foi poss\u00edvel salvar os arquivos: ${error.message}`, true); }
  });

  async function loadVehicleCatalog() {
    const response = await fetch('assets/vehicle-catalog.json?v=4');
    if (!response.ok) throw new Error('N\u00e3o foi poss\u00edvel carregar o cat\u00e1logo de ve\u00edculos.');
    const data = await response.json();
    catalogVehicles = data.vehicles || [];
    fillAudioCatalog();
  }

  function render() {
    const search = $('#searchInput').value.trim().toLowerCase();
    const filter = $('#filterSelect').value;
    const visibleItems = soundOffKeys === null ? items : items.filter(item => soundOffKeys.has(item.key));
    const shown = visibleItems.filter(item => {
      const text = `${item.model} ${item.path} ${item.audio}`.toLowerCase();
      return text.includes(search) && (filter === 'all' || (filter === 'missing' && !item.audio) || (filter === 'filled' && !!item.audio));
    });
    rows.innerHTML = shown.map(item => `<tr data-key="${esc(item.key)}"><td><input class="row-check" type="checkbox" ${selectedKeys.has(item.key) ? 'checked' : ''} aria-label="Selecionar ${esc(item.model)}"></td><td><span class="model-name">${esc(item.model)}</span></td><td><div class="file-name" title="${esc(item.path)}">${esc(item.path)}</div></td><td><span class="audio-current ${item.audio ? '' : 'empty'}">${item.audio ? esc(item.audio) : 'Vazio'}</span></td><td><span class="status-pill ${item.audio ? '' : 'missing'}">${item.audio ? 'Preenchido' : 'Sem \u00e1udio'}</span></td></tr>`).join('');
    $('#vehicleCount').textContent = String(visibleItems.length);
    $('#tableSummary').textContent = `${shown.length} exibido(s) \u00b7 ${visibleItems.filter(item => !item.audio).length} sem \u00e1udio \u00b7 ${visibleItems.filter(item => item.audio).length} com \u00e1udio${soundOffKeys === null ? '' : ' \u00b7 sele\u00e7\u00e3o SOM-OFF'}`;
    $('#emptySearch').classList.toggle('hidden', shown.length > 0);
    $('#selectAll').checked = shown.length > 0 && shown.every(item => selectedKeys.has(item.key));
  }

  $('#scanRoot').addEventListener('click', async () => {
    if (!window.showDirectoryPicker) return notify('Abra este painel no Google Chrome ou Microsoft Edge para escolher uma pasta.', true);
    const button = $('#scanRoot'); button.disabled = true;
    try {
      rootHandle = await window.showDirectoryPicker({mode:'readwrite'});
      const result = await scanFolder(rootHandle);
      if (!result.items.length) throw new Error('N\u00e3o encontrei nenhum vehicles.meta com modelName na pasta selecionada ou em suas subpastas.');
      items = result.items; fileHandles = result.handles; soundOffKeys = null; selectedKeys.clear();
      $('#clearSoundOff').classList.add('hidden');
      $('#soundOffStatus').textContent = 'Escolha a pasta SOM-OFF para comparar os nomes dos ve\u00edculos.';
      $('#selectedRoot').textContent = `${rootHandle.name} \u00b7 ${items.length} ve\u00edculo(s) encontrado(s)`;
      panel.classList.remove('hidden');
      $('#insertAudio').disabled = false;
      populateAudios();
      $('#insertHint').textContent = 'Escolha a classe e o \u00e1udio. Os \u00e1udios encontrados s\u00e3o lidos dos vehicles.meta da pasta selecionada.';
      render();
      notify(`${items.length} ve\u00edculo(s) encontrado(s) em ${rootHandle.name}.`);
    } catch (error) { if (error.name !== 'AbortError') notify(error.message, true); }
    finally { button.disabled = false; }
  });

  $('#scanSoundOff').addEventListener('click', async () => {
    if (!rootHandle || !items.length) return notify('Escolha primeiro a pasta dos vehicles.meta.', true);
    const button = $('#scanSoundOff'); button.disabled = true;
    try {
      const folder = await window.showDirectoryPicker({mode:'read'});
      const names = new Set();
      for await (const [name, entry] of folder.entries()) if (entry.kind === 'directory') names.add(name.trim().toLocaleLowerCase());
      if (!names.size) throw new Error('A pasta SOM-OFF n\u00e3o cont\u00e9m subpastas com nomes de ve\u00edculos.');
      const matchedNames = new Set();
      soundOffKeys = new Set(items.filter(item => {
        if (!item.audio) return false;
        const folders = item.path.split('/').slice(0, -1);
        const vehicleFolder = folders.at(-1)?.toLocaleLowerCase() === 'data' ? folders.at(-2) : folders.at(-1);
        const candidates = [item.model, vehicleFolder].filter(Boolean).map(name => name.trim().toLocaleLowerCase());
        const match = candidates.find(name => names.has(name));
        if (match) matchedNames.add(match);
        return !!match;
      }).map(item => item.key));
      selectedKeys = new Set(soundOffKeys);
      $('#searchInput').value = '';
      $('#filterSelect').value = 'all';
      $('#applyAll').checked = false;
      $('#clearSoundOff').classList.remove('hidden');
      const unmatched = [...names].filter(name => !matchedNames.has(name));
      $('#soundOffStatus').textContent = `${folder.name}: ${soundOffKeys.size} ve\u00edculo(s) selecionado(s). ${unmatched.length ? `Sem correspond\u00eancia: ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? ` e mais ${unmatched.length - 10}` : ''}.` : 'Todos os nomes corresponderam.'}`;
      render();
      panel.scrollIntoView({behavior:'smooth', block:'start'});
      notify(`${soundOffKeys.size} ve\u00edculo(s) SOM-OFF encontrados.`);
    } catch (error) { if (error.name !== 'AbortError') notify(error.message, true); }
    finally { button.disabled = false; }
  });

  $('#clearSoundOff').addEventListener('click', () => {
    soundOffKeys = null; selectedKeys.clear();
    $('#clearSoundOff').classList.add('hidden');
    $('#soundOffStatus').textContent = 'Escolha a pasta SOM-OFF para comparar os nomes dos ve\u00edculos.';
    render();
  });

  loadVehicleCatalog().catch(error => notify(error.message, true));
  classSelect.addEventListener('change', populateAudios);
  audioSelect.addEventListener('change', () => { customAudio.classList.toggle('hidden', audioSelect.value !== '__custom'); updateVehiclePreview(); });
  $('#searchInput').addEventListener('input', render);
  $('#filterSelect').addEventListener('change', render);
  $('#selectAll').addEventListener('change', event => rows.querySelectorAll('tr').forEach(row => {
    row.querySelector('.row-check').checked = event.target.checked;
    if (event.target.checked) selectedKeys.add(row.dataset.key); else selectedKeys.delete(row.dataset.key);
  }));
  rows.addEventListener('change', event => {
    if (!event.target.matches('.row-check')) return;
    const key = event.target.closest('tr').dataset.key;
    if (event.target.checked) selectedKeys.add(key); else selectedKeys.delete(key);
    $('#selectAll').checked = [...rows.querySelectorAll('.row-check')].every(box => box.checked);
  });

  $('#insertAudio').addEventListener('click', async () => {
    if (!rootHandle || !items.length) return notify('Escolha primeiro a pasta com os ve\u00edculos.', true);
    const selectedValue = audioSelect.value;
    const chosenVehicle = selectedValue.startsWith('vehicle:') ? catalogVehicles[Number(selectedValue.slice(8))] : null;
    const chosenCustom = selectedValue.startsWith('custom:') ? selectedValue.slice(7) : '';
    const audio = (chosenVehicle?.audio || chosenCustom || (selectedValue === '__custom' ? customAudio.value : selectedValue)).trim().toUpperCase();
    if (!validAudio(audio)) return notify('Escolha um \u00e1udio da lista ou digite um nome v\u00e1lido.', true);
    const keys = $('#applyAll').checked ? (soundOffKeys === null ? items.map(item => item.key) : [...soundOffKeys]) : [...selectedKeys];
    if (!keys.length) return notify('Marque os ve\u00edculos que receber\u00e3o o \u00e1udio.', true);
    const existing = items.filter(item => keys.includes(item.key) && item.audio);
    const replace = existing.length > 0 && window.confirm(`${existing.length} ve\u00edculo(s) j\u00e1 t\u00eam \u00e1udio (${[...new Set(existing.map(item => item.audio))].join(', ')}). OK substitui; Cancelar mant\u00e9m os atuais e preenche somente os vazios.`);
    const updates = {};
    keys.forEach(key => { const item = items.find(entry => entry.key === key); if (!item.audio || replace) updates[key] = audio; });
    if (!Object.keys(updates).length) return notify('Nenhum campo vazio para preencher. \u00c1udios atuais mantidos.');
    const button = $('#insertAudio'); button.disabled = true;
    try {
      const grouped = new Map();
      Object.entries(updates).forEach(([key,value]) => { const split = key.lastIndexOf('::'), path = key.slice(0,split); if (!grouped.has(path)) grouped.set(path,{}); grouped.get(path)[key] = value; });
      for (const [path,changes] of grouped) {
        const handle = fileHandles.get(path);
        if (!handle) throw new Error(`O arquivo n\u00e3o est\u00e1 dispon\u00edvel: ${path}`);
        const file = await handle.getFile();
        let index = 0;
        const output = (await file.text()).replace(/<Item\b[^>]*>[\s\S]*?<\/Item>/gi, block => {
          const key = `${path}::${index++}`;
          if (!Object.hasOwn(changes,key)) return block;
          if (/<audioNameHash\b[^>]*>[\s\S]*?<\/audioNameHash>/i.test(block)) return block.replace(/(<audioNameHash\b[^>]*>)[\s\S]*?(<\/audioNameHash>)/i, `$1${changes[key]}$2`);
          if (/<audioNameHash\b[^>]*\/>/i.test(block)) return block.replace(/<audioNameHash\b[^>]*\/>/i, `<audioNameHash>${changes[key]}</audioNameHash>`);
          return block.replace(/(<modelName\b[^>]*>[\s\S]*?<\/modelName>)/i, `$1\n      <audioNameHash>${changes[key]}</audioNameHash>`);
        });
        const writable = await handle.createWritable();
        try { await writable.write(output); await writable.close(); } catch (error) { await writable.abort(); throw error; }
      }
      items = items.map(item => Object.hasOwn(updates,item.key) ? {...item,audio} : item);
      populateAudios(); render();
      const kept = keys.length - Object.keys(updates).length;
      $('#insertHint').textContent = `${Object.keys(updates).length} ve\u00edculo(s) salvo(s) diretamente em ${rootHandle.name}.${kept ? ` ${kept} mantido(s).` : ''}`;
      notify(`${Object.keys(updates).length} ve\u00edculo(s) salvo(s) nos arquivos originais.`);
    } catch (error) { notify(error.message,true); }
    finally { button.disabled = false; }
  });
})();
