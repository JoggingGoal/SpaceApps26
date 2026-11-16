/**
 * The Green Revolution — free 3D globe.
 * No Spline subscription or API key. Requires the freely licensed Three.js library.
 * Optional high-resolution surface imagery is loaded from the Three.js example server;
 * a bundled local cartographic texture is used if the remote asset is unavailable.
 */
const host = document.getElementById('three-earth-host');

if (host && typeof WebGLRenderingContext !== 'undefined') {
  initGlobe(host).catch(err => {
    console.warn('3D globe unavailable; showing the static Earth background.', err);
  });
}

async function initGlobe(host) {
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.035, 100);
  camera.position.set(0, 0, 5.8);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x06100d, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
  host.append(renderer.domElement);

  // Gentle physically motivated lighting: sunlight at left, faint fill on night side.
  scene.add(new THREE.AmbientLight(0xb2c5da, 0.35));
  const sunlight = new THREE.DirectionalLight(0xffffff, 2.3);
  sunlight.position.set(-4, 2.5, 5);
  scene.add(sunlight);

  const planet = new THREE.Group();
  scene.add(planet);
  const textureLoader = new THREE.TextureLoader();
  const earthMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 20, specular: 0x142a3d });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1.44, 96, 64), earthMat);
  planet.add(earth);
  // Start facing approximately toward North America.
  earth.rotation.y = 2.7;

  const applyColorTexture = url => new Promise((resolve,reject) => {
    textureLoader.load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      earthMat.map = tex;
      earthMat.needsUpdate = true;
      resolve();
    }, undefined, reject);
  });

  // Load a bundled fallback quickly; replace it with the higher-fidelity imagery when available.
  await applyColorTexture('../assets/images/earth_fallback.jpg');
  applyColorTexture('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg').catch(() => {
    // Bundled globe texture remains visible, no visual interruption.
  });

  const cloudTexture = textureLoader.load('../assets/images/earth_clouds.png');
  cloudTexture.colorSpace = THREE.SRGBColorSpace;
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.463, 80, 48),
    new THREE.MeshPhongMaterial({ map: cloudTexture, transparent: true, opacity: 0.46, depthWrite: false, blending: THREE.NormalBlending })
  );
  planet.add(clouds);
  clouds.rotation.y = 2.7;

  // A subtle atmospheric edge glow using a Fresnel term and transparent blending.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.53, 80, 48),
    new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vNormal; varying vec3 vEye; void main(){vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vEye=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec3 vNormal; varying vec3 vEye; void main(){float fresnel=pow(1.0-max(0.0,dot(normalize(vNormal),normalize(vEye))),4.2);gl_FragColor=vec4(0.20,0.54,0.85,0.42*fresnel);}`,
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending
    })
  );
  planet.add(atmosphere);

  const starsCount = 550;
  const positions = new Float32Array(starsCount * 3);
  for (let i=0;i<starsCount;i++) {
    const theta = Math.random() * Math.PI * 2;
    const z = (Math.random() - 0.5) * 2;
    const r = Math.sqrt(1-z*z);
    const distance = 16 + Math.random() * 15;
    positions[i*3] = Math.cos(theta) * r * distance;
    positions[i*3+1] = z * distance;
    positions[i*3+2] = Math.sin(theta) * r * distance;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({color:0xb6d8e2,size:0.043,transparent:true,opacity:0.5,sizeAttenuation:true}));
  scene.add(stars);

  const target = {x:0,y:0};
  const mouse = {x:0,y:0};
  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    mouse.x = (event.clientX / innerWidth - 0.5) * 2;
    mouse.y = (event.clientY / innerHeight - 0.5) * 2;
  }, {passive:true});

  let progress = 0;
  let cameraZ = 5.8;
  let baseCameraZ = 5.8;
  const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
  const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
  // The camera moves toward the sphere. We zoom the model, not just its HTML wrapper.
  window.GreenRevolutionEarth = {
    setProgress(p){
      progress = clamp(p);
      if (reduceMotion.matches) { camera.position.z=baseCameraZ; renderer.render(scene,camera); }
    }
  };

  window.dispatchEvent(new Event('green-earth-ready'));

  function resize() {
    const width=Math.max(1,host.clientWidth), height=Math.max(1,host.clientHeight);
    renderer.setSize(width,height,false);
    camera.aspect=width/height;
    baseCameraZ = width<600 ? 7.0 : width<1000 ? 6.3 : 5.8;
    camera.position.z = baseCameraZ;
    cameraZ = baseCameraZ;
    camera.updateProjectionMatrix();
    planet.position.x=width>900 ? 0.44:0;
  }
  new ResizeObserver(resize).observe(host);
  resize();

  let isVisible=true;
  let frameId=0;
  const clock=new THREE.Clock();
  const observer=new IntersectionObserver(([entry]) => {
    isVisible=entry.isIntersecting;
    if(isVisible && !frameId) animate();
  },{threshold:0.01});
  observer.observe(host);

  function animate(){
    frameId=0;
    if (!isVisible || document.hidden) return;
    const dt=Math.min(clock.getDelta(),0.06);
    if(!reduceMotion.matches){
      // The actual continent texture spins (one turn about every 39s).
      earth.rotation.y += dt*0.16;
      clouds.rotation.y += dt*0.18;
      target.x += ((mouse.y * 0.055)-target.x)*0.03;
      target.y += ((mouse.x * 0.085)-target.y)*0.03;
      planet.rotation.x=target.x;
      planet.rotation.y=target.y;
    }
    // Bring the camera near the visible surface before fading to farmland.
    const approach = smooth(0.05,0.82,progress);
    const desiredZ = baseCameraZ + (1.63-baseCameraZ)*approach;
    cameraZ += (desiredZ-cameraZ)*Math.min(1,dt*8+0.05);
    camera.position.z = cameraZ;
    // Tilt slightly toward North America as the camera approaches.
    camera.position.y = -0.12*approach;
    camera.updateProjectionMatrix();
    renderer.render(scene,camera);
    if (!reduceMotion.matches) frameId=requestAnimationFrame(animate);
  }
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && isVisible && !frameId) animate();
  });
  animate();
  document.documentElement.classList.add('three-earth-ready');
}
