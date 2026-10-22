import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (selector) => document.querySelector(selector);
const cards = $('#vehicleCards');
const categoryFilter = $('#libraryCategory');
const searchField = $('#librarySearch');
const dialog = $('#vehicleDialog');
const stage = $('#modelViewer');
const image = $('#dialogVehicleImage');
const soundPlayer = $('#dialogCustomAudio');
const categories = {
  Boats:'Barcos', Commercial:'Comerciais', Compacts:'Compactos', Coupes:'Cup\u00eas', Cycles:'Bicicletas',
  Emergency:'Emerg\u00eancia', Helicopters:'Helic\u00f3pteros', Industrial:'Industriais', Military:'Militares',
  Motorcycles:'Motocicletas', Muscle:'Mus\u00faculos', 'Off-Road':'Fora de estrada', 'Open Wheel':'Rodas abertas',
  Planes:'Avi\u00f5es', Rail:'Trens', Sedans:'Sed\u00e3s', Service:'Servi\u00e7o', Sports:'Esportivos',
  'Sports Classics':'Cl\u00e1ssicos esportivos', Super:'Superesportivos', SUVs:'SUVs', Utility:'Utilit\u00e1rios',
  Vans:'Vans', Tuners:'Preparados', 'Remote Control':'Controle remoto'
};
let vehicles = [];
let currentVehicle = null;
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let activeModel = null;
let animationFrame = 0;
let resizeObserver = null;
let soundUrl = null;
let loadToken = 0;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

function categoryLabel(value) { return categories[value] || value || 'Sem categoria'; }

function cardImage(vehicle) {
  return vehicle.spawn
    ? `https://gta.mics.dev/img/vehicles/${encodeURIComponent(vehicle.spawn)}.png`
    : vehicle.image || '';
}

function renderCards() {
  const category = categoryFilter.value;
  const query = normalize(searchField.value.trim());
  const filtered = vehicles.filter(vehicle => {
    const matchesCategory = category === 'all' || (vehicle.categories || []).includes(category);
    const haystack = normalize(`${vehicle.name} ${vehicle.spawn || ''} ${vehicle.audio}`);
    return matchesCategory && haystack.includes(query);
  });
  $('#libraryCount').textContent = `${filtered.length} de ${vehicles.length} ve\u00edculos`;
  cards.innerHTML = filtered.length ? filtered.map(vehicle => {
    const index = vehicles.indexOf(vehicle);
    const categoriesText = (vehicle.categories || []).map(categoryLabel).join(' · ') || 'Sem categoria';
    return `<button class="vehicle-card" type="button" data-vehicle-index="${index}" aria-label="Abrir ${escapeHtml(vehicle.name)} em 3D">
      <span class="vehicle-card-image"><img src="${escapeHtml(cardImage(vehicle))}" alt="${escapeHtml(vehicle.name)}" loading="lazy"><span class="vehicle-card-open">VER EM 3D</span></span>
      <span class="vehicle-card-copy"><strong>${escapeHtml(vehicle.name)}</strong><small>${escapeHtml(categoriesText)} <i>·</i> <code>${escapeHtml(vehicle.spawn || vehicle.audio)}</code></small><small class="vehicle-card-audio">Motor: <code>${escapeHtml(vehicle.audio || vehicle.spawn?.toUpperCase())}</code></small></span>
    </button>`;
  }).join('') : '<p class="library-empty">Nenhum ve\u00edculo encontrado para esse filtro.</p>';
  cards.querySelectorAll('.vehicle-card img').forEach(img => {
    img.addEventListener('error', () => {
      const vehicle = vehicles[Number(img.closest('.vehicle-card').dataset.vehicleIndex)];
      if (vehicle?.image && img.src !== vehicle.image) img.src = vehicle.image;
      else img.classList.add('image-missing');
    }, {once:true});
  });
}

function setViewerStatus(message) {
  let status = stage.querySelector('.model-viewer-status');
  if (!status) { status = document.createElement('div'); status.className = 'model-viewer-status'; stage.prepend(status); }
  status.textContent = message;
  status.classList.remove('hidden');
}

function disposeViewer() {
  loadToken++;
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect(); resizeObserver = null;
  controls?.dispose(); controls = null;
  if (scene) scene.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
  scene = null; camera = null;
  if (renderer) { renderer.dispose(); renderer.domElement.remove(); renderer = null; }
  activeModel = null;
  $('#resetModelView').classList.add('hidden');
}

function initViewer(vehicle) {
  disposeViewer();
  const token = loadToken;
  const status = stage.querySelector('.model-viewer-status');
  if (!vehicle.spawn) {
    setViewerStatus('O modelo 3D n\u00e3o est\u00e1 dispon\u00edvel para este ve\u00edculo no cat\u00e1logo de origem.');
    return;
  }
  setViewerStatus('Carregando modelo 3D...');
  const canvas = document.createElement('canvas');
  canvas.className = 'vehicle-canvas';
  stage.insertBefore(canvas, stage.querySelector('.model-reset'));
  renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#101410');
  camera = new THREE.PerspectiveCamera(34, 1, .01, 10000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x34452c, 2.3));
  const key = new THREE.DirectionalLight(0xffffff, 3.4); key.position.set(4, 8, 6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc4f265, 1.1); fill.position.set(-5, 3, -4); scene.add(fill);
  const grid = new THREE.GridHelper(24, 40, 0x536b35, 0x263222); grid.position.y = -.015; scene.add(grid);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .075; controls.minDistance = .5; controls.maxDistance = 120; controls.target.set(0, .6, 0);
  const resize = () => {
    if (!renderer || !camera) return;
    const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  };
  resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage); resize();
  const loader = new GLTFLoader();
  loader.load(`vehicle-model.php?model=${encodeURIComponent(vehicle.spawn)}`, gltf => {
    if (token !== loadToken) return;
    activeModel = gltf.scene;
    activeModel.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    const bounds = new THREE.Box3().setFromObject(activeModel);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 1);
    activeModel.position.sub(center);
    scene.add(activeModel);
    grid.scale.setScalar(Math.max(1, maxSize / 8));
    grid.position.y = -size.y * .5;
    camera.near = maxSize / 1000; camera.far = maxSize * 100;
    camera.position.set(maxSize * 1.45, maxSize * .82, maxSize * 1.6);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0); controls.minDistance = maxSize * .65; controls.maxDistance = maxSize * 8; controls.update();
    status.textContent = 'Arraste para girar · use a roda do mouse para aproximar';
    $('#resetModelView').classList.remove('hidden');
  }, progress => {
    if (token === loadToken && progress.total) status.textContent = `Carregando modelo 3D: ${Math.round(progress.loaded / progress.total * 100)}%`;
  }, () => {
    if (token === loadToken) setViewerStatus('N\u00e3o foi poss\u00edvel carregar este modelo 3D. Tente novamente mais tarde.');
  });
  const draw = () => { animationFrame = requestAnimationFrame(draw); controls?.update(); renderer?.render(scene, camera); };
  draw();
}

function openVehicle(vehicle) {
  currentVehicle = vehicle;
  $('#dialogVehicleName').textContent = vehicle.name;
  $('#dialogVehicleSpawn').textContent = vehicle.spawn || 'Modelo indispon\u00edvel';
  $('#dialogVehicleCategory').textContent = (vehicle.categories || []).map(categoryLabel).join(' · ') || 'Sem categoria';
  $('#dialogVehicleAudio').textContent = vehicle.audio || 'N\u00e3o informado';
  const modelImage = cardImage(vehicle);
  image.src = modelImage;
  image.alt = vehicle.name;
  image.onerror = () => { image.src = vehicle.image || ''; };
  image.classList.remove('hidden');
  $('#dialogAudioTrack').textContent = vehicle.audio || vehicle.spawn?.toUpperCase() || 'Som do motor';
  $('#dialogAudioNote').textContent = 'Carregando áudio do motor...';
  soundPlayer.pause(); soundPlayer.removeAttribute('src'); soundPlayer.load(); soundPlayer.classList.add('audio-unavailable');
  if (soundUrl) { URL.revokeObjectURL(soundUrl); soundUrl = null; }
  dialog.classList.remove('hidden'); document.body.classList.add('vehicle-dialog-open');
  initViewer(vehicle);
  getCustomAudio(vehicle.audio).then(file => {
    if (currentVehicle !== vehicle) return;
    if (!file) {
      $('#dialogAudioNote').textContent = 'O catálogo informa o nome do motor, mas não fornece uma gravação reproduzível. Cadastre uma amostra personalizada para ouvir aqui.';
      return;
    }
    soundUrl = URL.createObjectURL(file);
    soundPlayer.src = soundUrl; soundPlayer.classList.remove('audio-unavailable');
    $('#dialogAudioNote').textContent = 'Amostra personalizada deste motor.';
  }).catch(() => { if (currentVehicle === vehicle) $('#dialogAudioNote').textContent = 'Não foi possível carregar a amostra de áudio.'; });
}

function closeDialog() {
  dialog.classList.add('hidden'); document.body.classList.remove('vehicle-dialog-open');
  soundPlayer.pause(); soundPlayer.removeAttribute('src'); soundPlayer.load(); soundPlayer.classList.remove('audio-unavailable');
  if (soundUrl) { URL.revokeObjectURL(soundUrl); soundUrl = null; }
  currentVehicle = null; disposeViewer();
}

async function getCustomAudio(hash) {
  const names = JSON.parse(localStorage.getItem('garageAudioCustomNames') || '[]');
  const record = names.find(item => item.name.toLowerCase() === String(hash || '').toLowerCase() && item.hasFile);
  if (!record) return null;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('garage-audio-custom', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db.transaction('sounds').objectStore('sounds').get(record.name);
    request.onsuccess = () => resolve(request.result?.file || null);
    request.onerror = () => reject(request.error);
  });
}

async function loadCatalog() {
  try {
    const response = await fetch('assets/vehicle-catalog.json?v=4');
    if (!response.ok) throw new Error('Falha ao carregar o cat\u00e1logo.');
    const data = await response.json();
    vehicles = data.vehicles || [];
    const categoryList = [...new Set(vehicles.flatMap(vehicle => vehicle.categories || []))].sort((a,b) => categoryLabel(a).localeCompare(categoryLabel(b), 'pt-BR'));
    categoryFilter.innerHTML = '<option value="all">Todas as categorias</option>' + categoryList.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(categoryLabel(category))}</option>`).join('');
    renderCards();
  } catch (error) { $('#libraryCount').textContent = error.message; }
}

categoryFilter.addEventListener('change', renderCards);
searchField.addEventListener('input', renderCards);
cards.addEventListener('click', event => {
  const card = event.target.closest('[data-vehicle-index]');
  if (card) openVehicle(vehicles[Number(card.dataset.vehicleIndex)]);
});
$('#closeVehicleDialog').addEventListener('click', closeDialog);
dialog.querySelectorAll('[data-dialog-close]').forEach(element => element.addEventListener('click', closeDialog));
$('#resetModelView').addEventListener('click', () => currentVehicle && initViewer(currentVehicle));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !dialog.classList.contains('hidden')) closeDialog(); });
loadCatalog();
