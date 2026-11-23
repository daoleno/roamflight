import * as THREE from 'three';

export function cloudMesh(count, uniforms, hazeScale, segments = 16) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, hazeScale: { value: hazeScale } },
    vertexShader: `varying vec3 vWorld,vNormal;
      void main(){
        vec4 world=modelMatrix*instanceMatrix*vec4(position,1.);vWorld=world.xyz;
        vec3 n=normal/vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));
        vNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*n);
        gl_Position=projectionMatrix*viewMatrix*world;
      }`,
    fragmentShader: `uniform vec3 sun;uniform float night,hazeScale;varying vec3 vWorld,vNormal;
      void main(){
        vec3 n=normalize(vNormal),view=normalize(cameraPosition-vWorld);
        float diffuse=clamp((dot(n,sun)+.65)/1.65,0.,1.);
        float silver=pow(1.-abs(dot(n,view)),3.)*pow(max(0.,dot(view,-sun)),3.);
        vec3 shade=mix(vec3(.44,.55,.66),vec3(1.,.98,.91),diffuse)+silver*.15;
        float haze=1.-exp(-distance(cameraPosition,vWorld)*hazeScale);
        shade=mix(shade,vec3(.27,.46,.68),haze*.5);
        shade=mix(shade,shade*vec3(.085,.12,.19),night);
        gl_FragColor=vec4(shade,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, segments, segments * 0.75),
    material,
    count,
  );
}

// Horizontal scenes use fixed geographic sunlight and local metres or kilometres.
export function localSky(scene, street) {
  const unit = street ? 1000 : 1;
  const uniforms = {
    sun: { value: new THREE.Vector3(-0.84, 0.88, 0.38).normalize() },
    night: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=gl_Position.w;}',
      fragmentShader: `varying vec3 direction;uniform vec3 sun;uniform float night;
    void main(){
      vec3 d=normalize(direction);
      float h=pow(clamp(d.y*1.8,0.,1.),.55);
      vec3 day=mix(vec3(.29,.52,.78),vec3(.037,.145,.39),h);
      day+=vec3(1.,.77,.43)*.60*pow(max(dot(sun,d),0.),70.);
      gl_FragColor=vec4(mix(day,vec3(.006,.012,.032),night),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb=mix(mix(vec3(.714,.839,.929),vec3(.137,.216,.282),night),gl_FragColor.rgb,smoothstep(-.018,.12,d.y));
    }`,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = 10;
  const clouds = cloudMesh(49 * 6, uniforms, street ? 0.00006 : 0.014, 8);
  clouds.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const spacing = (street ? 2.9 : 12) * unit;
  let cellX = Infinity,
    cellZ = Infinity;
  scene.add(sky, clouds);
  return {
    sunDirection: uniforms.sun.value,
    update(camera, ground, dark, chart, visible) {
      sky.visible = !chart;
      clouds.visible = visible && !chart;
      uniforms.night.value = Number(dark);
      sky.position.copy(camera.position);
      const cx = Math.floor(camera.position.x / spacing),
        cz = Math.floor(camera.position.z / spacing);
      if (!clouds.visible || (cx === cellX && cz === cellZ)) return;
      cellX = cx;
      cellZ = cz;
      let index = 0;
      for (let j = cz - 3; j <= cz + 3; j++)
        for (let i = cx - 3; i <= cx + 3; i++) {
          let seed = Math.imul(i + 1651, 73856093) ^ Math.imul(j - 733, 19349663);
          const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
          const x = (i + 0.15 + 0.7 * random()) * spacing,
            z = (j + 0.15 + 0.7 * random()) * spacing;
          const y = ground(x, z) + (street ? 0.92 + random() * 0.65 : 3.1 + random() * 2.4) * unit;
          const span = (0.047 + 0.082 * random()) * spacing;
          for (let k = 0; k < 6; k++) {
            const s = span * (0.26 + 0.33 * random());
            dummy.position.set(
              x + (random() - 0.5) * span * 1.8,
              y + random() * 0.25 * span,
              z + (random() - 0.5) * span,
            );
            dummy.scale.set(s * 1.35, s * 0.78, s);
            dummy.updateMatrix();
            clouds.setMatrixAt(index++, dummy.matrix);
          }
        }
      clouds.instanceMatrix.needsUpdate = true;
    },
  };
}
