/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  HYPER-SID ADVANCED WEBGL SHADERS                           ║
 * ║  • Bloom with Chromatic Aberration                          ║
 * ║  • CRT Phosphor Persistence                                 ║
 * ║  • Volumetric Lighting                                      ║
 * ║  • Particle System GPU Compute                              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ============================================================================
// BLOOM + CHROMATIC ABERRATION POST-PROCESSING
// ============================================================================

export const BLOOM_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const BLOOM_FRAGMENT_SHADER = `
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float intensity;
uniform float threshold;
varying vec2 vUv;

// Gaussian blur coefficients
const float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

vec3 blur(sampler2D tex, vec2 uv, vec2 direction) {
    vec3 result = texture2D(tex, uv).rgb * weights[0];
    
    for(int i = 1; i < 5; i++) {
        vec2 offset = direction * float(i) / resolution;
        result += texture2D(tex, uv + offset).rgb * weights[i];
        result += texture2D(tex, uv - offset).rgb * weights[i];
    }
    
    return result;
}

void main() {
    vec3 color = texture2D(tDiffuse, vUv).rgb;
    
    // Extract bright areas
    float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 bright = brightness > threshold ? color : vec3(0.0);
    
    // Two-pass blur
    vec3 bloomH = blur(tDiffuse, vUv, vec2(1.0, 0.0));
    vec3 bloomV = blur(tDiffuse, vUv, vec2(0.0, 1.0));
    vec3 bloom = (bloomH + bloomV) * 0.5 * intensity;
    
    // Chromatic aberration on bloom
    float aberration = 0.003;
    vec3 bloomR = blur(tDiffuse, vUv + vec2(aberration, 0.0), vec2(1.0, 0.0));
    vec3 bloomB = blur(tDiffuse, vUv - vec2(aberration, 0.0), vec2(1.0, 0.0));
    
    vec3 chromaticBloom = vec3(bloomR.r, bloom.g, bloomB.b);
    
    // Combine
    gl_FragColor = vec4(color + chromaticBloom * intensity, 1.0);
}
`;

// ============================================================================
// CRT PHOSPHOR PERSISTENCE SHADER
// ============================================================================

export const CRT_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const CRT_FRAGMENT_SHADER = `
uniform sampler2D tDiffuse;
uniform sampler2D tPersistence;
uniform vec2 resolution;
uniform float time;
uniform float persistenceDecay;
varying vec2 vUv;

// CRT curvature
vec2 curveRemapUV(vec2 uv) {
    uv = uv * 2.0 - 1.0;
    vec2 offset = abs(uv.yx) / vec2(6.0, 4.0);
    uv = uv + uv * offset * offset;
    uv = uv * 0.5 + 0.5;
    return uv;
}

// RGB phosphor mask
vec3 phosphorMask(vec2 uv) {
    vec2 pixel = uv * resolution;
    float mask = 1.0;
    
    // Vertical RGB stripes
    float x = mod(pixel.x, 3.0);
    vec3 rgb = vec3(0.0);
    if (x < 1.0) rgb.r = 1.0;
    else if (x < 2.0) rgb.g = 1.0;
    else rgb.b = 1.0;
    
    return rgb * 0.3 + 0.7; // Subtle mask
}

// Scanlines
float scanline(vec2 uv) {
    float line = sin(uv.y * resolution.y * 3.14159 * 2.0) * 0.5 + 0.5;
    return line * 0.3 + 0.7;
}

// Vignette
float vignette(vec2 uv) {
    float dist = distance(uv, vec2(0.5)) * 1.4;
    return smoothstep(0.8, 0.3, dist);
}

void main() {
    vec2 curvedUV = curveRemapUV(vUv);
    
    // Out of bounds check
    if (curvedUV.x < 0.0 || curvedUV.x > 1.0 || curvedUV.y < 0.0 || curvedUV.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    
    // Current frame
    vec3 current = texture2D(tDiffuse, curvedUV).rgb;
    
    // Previous frame (phosphor persistence)
    vec3 persistence = texture2D(tPersistence, curvedUV).rgb * persistenceDecay;
    
    // Combine with max (phosphor glow)
    vec3 color = max(current, persistence);
    
    // Apply CRT effects
    color *= phosphorMask(curvedUV);
    color *= scanline(curvedUV);
    color *= vignette(curvedUV);
    
    // Slight flicker
    color *= 1.0 + sin(time * 60.0) * 0.01;
    
    // Color correction (warm CRT tint)
    color = pow(color, vec3(1.0 / 2.2)); // Gamma correction
    color *= vec3(1.0, 0.98, 0.95); // Warm tint
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ============================================================================
// VOLUMETRIC LIGHTING SHADER (God Rays)
// ============================================================================

export const VOLUMETRIC_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const VOLUMETRIC_FRAGMENT_SHADER = `
uniform sampler2D tDiffuse;
uniform vec3 lightPosition;
uniform vec3 cameraPosition;
uniform float intensity;
uniform float decay;
uniform int samples;
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
    vec3 color = texture2D(tDiffuse, vUv).rgb;
    
    // Ray from camera through pixel
    vec3 rayDir = normalize(vWorldPosition - cameraPosition);
    
    // Light direction
    vec3 lightDir = normalize(lightPosition - cameraPosition);
    
    // Volumetric lighting accumulation
    float volumetric = 0.0;
    vec3 rayStep = rayDir * 0.1;
    vec3 rayPos = cameraPosition;
    
    for(int i = 0; i < 32; i++) {
        if(i >= samples) break;
        
        // Distance attenuation
        float dist = length(rayPos - lightPosition);
        float atten = 1.0 / (1.0 + dist * dist * decay);
        
        // Accumulate
        volumetric += atten * intensity;
        rayPos += rayStep;
    }
    
    volumetric /= float(samples);
    
    // Light scattering color (cyan/magenta)
    vec3 scatterColor = vec3(0.0, 1.0, 1.0);
    
    gl_FragColor = vec4(color + scatterColor * volumetric, 1.0);
}
`;

// ============================================================================
// WAVEFORM PARTICLE SYSTEM SHADER
// ============================================================================

export const PARTICLE_VERTEX_SHADER = `
uniform float time;
uniform float amplitude;
attribute float phase;
attribute vec3 velocity;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    // Oscillate based on phase
    pos.y += sin(phase + time * 2.0) * amplitude;
    pos.x += cos(phase * 0.5 + time) * amplitude * 0.5;
    
    // Add velocity
    pos += velocity * time * 0.1;
    
    // Color based on position
    vColor = vec3(
        0.5 + 0.5 * sin(phase),
        0.5 + 0.5 * cos(phase * 1.3),
        0.5 + 0.5 * sin(phase * 0.7)
    );
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 3.0 * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const PARTICLE_FRAGMENT_SHADER = `
varying vec3 vColor;

void main() {
    // Circular particles with soft edges
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    
    if(dist > 0.5) discard;
    
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    
    gl_FragColor = vec4(vColor, alpha);
}
`;

// ============================================================================
// WAVEFORM MORPHING SHADER (For visualizing combined waveforms)
// ============================================================================

export const WAVEFORM_VERTEX_SHADER = `
uniform float morphFactor;
attribute vec3 targetPosition;
varying vec3 vColor;
varying vec2 vUv;

void main() {
    vUv = uv;
    
    // Morph between base and target position
    vec3 pos = mix(position, targetPosition, morphFactor);
    
    // Color based on morph factor
    vColor = vec3(
        morphFactor,
        1.0 - morphFactor,
        0.5 + 0.5 * sin(morphFactor * 3.14159)
    );
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const WAVEFORM_FRAGMENT_SHADER = `
varying vec3 vColor;
varying vec2 vUv;

void main() {
    // Glow effect
    float glow = 1.0 - length(vUv - vec2(0.5)) * 2.0;
    glow = pow(glow, 3.0);
    
    vec3 color = vColor + vec3(glow * 0.5);
    
    gl_FragColor = vec4(color, 0.8 + glow * 0.2);
}
`;

// ============================================================================
// OSCILLOSCOPE TRAIL SHADER
// ============================================================================

export const TRAIL_VERTEX_SHADER = `
attribute float age;
varying float vAge;
varying vec3 vColor;

void main() {
    vAge = age;
    
    // Fade color based on age
    vColor = vec3(
        0.0,
        1.0 - age * 0.5,
        1.0
    );
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 5.0 * (1.0 - age) * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const TRAIL_FRAGMENT_SHADER = `
varying float vAge;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    
    if(dist > 0.5) discard;
    
    float alpha = (1.0 - vAge) * (1.0 - dist * 2.0);
    
    gl_FragColor = vec4(vColor, alpha);
}
`;

// ============================================================================
// SPECTRUM ANALYZER BAR SHADER WITH REFLECTIONS
// ============================================================================

export const SPECTRUM_BAR_VERTEX_SHADER = `
uniform float height;
uniform float index;
uniform float totalBars;
uniform float time;
varying vec3 vColor;
varying vec2 vUv;
varying float vHeight;

void main() {
    vUv = uv;
    vHeight = height;
    
    // Rainbow color based on frequency
    float hue = index / totalBars;
    vColor = vec3(
        abs(sin(hue * 6.28318 + 0.0)),
        abs(sin(hue * 6.28318 + 2.09439)),
        abs(sin(hue * 6.28318 + 4.18879))
    );
    
    // Scale height
    vec3 pos = position;
    pos.y *= height + 0.1;
    
    // Wave effect
    pos.z += sin(time * 2.0 + index * 0.5) * 0.1;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const SPECTRUM_BAR_FRAGMENT_SHADER = `
varying vec3 vColor;
varying vec2 vUv;
varying float vHeight;

void main() {
    // Gradient from bottom to top
    vec3 color = vColor * (0.5 + vUv.y * 0.5);
    
    // Emissive based on height
    vec3 emissive = vColor * vHeight;
    
    // Fresnel-like edge glow
    float fresnel = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 3.0);
    
    vec3 finalColor = color + emissive + vColor * fresnel * 0.5;
    
    gl_FragColor = vec4(finalColor, 0.9);
}
`;

// ============================================================================
// NMOS TRANSISTOR VISUALIZATION SHADER
// ============================================================================

export const TRANSISTOR_VERTEX_SHADER = `
uniform float voltage;
uniform float current;
uniform float saturation;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    
    // Color based on operating region
    if(saturation > 0.8) {
        // Saturation region - blue
        vColor = vec3(0.0, 0.5, 1.0);
    } else if(voltage > 0.5) {
        // Linear region - cyan
        vColor = vec3(0.0, 1.0, 1.0);
    } else {
        // Off/subthreshold - dim red
        vColor = vec3(0.3, 0.0, 0.0);
    }
    
    // Scale based on current
    vec3 pos = position * (1.0 + current * 0.5);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const TRANSISTOR_FRAGMENT_SHADER = `
uniform float current;
uniform float power;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    // Lighting
    vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
    float diff = max(dot(vNormal, lightDir), 0.0);
    
    // Emissive glow based on power dissipation
    vec3 emissive = vColor * power * 2.0;
    
    // Combine
    vec3 color = vColor * (0.3 + diff * 0.7) + emissive;
    
    // Heat glow at edges
    float edge = pow(1.0 - abs(dot(vNormal, normalize(vPosition))), 2.0);
    color += vec3(1.0, 0.5, 0.0) * edge * power;
    
    gl_FragColor = vec4(color, 0.85);
}
`;

// ============================================================================
// FILTER TOPOLOGY CONNECTION SHADER (Animated Flow)
// ============================================================================

export const FILTER_CONNECTION_VERTEX_SHADER = `
uniform float time;
uniform float flowSpeed;
attribute float segmentIndex;
varying float vSegment;
varying vec3 vColor;

void main() {
    vSegment = segmentIndex;
    
    // Animated flow color
    float phase = mod(segmentIndex * 0.1 - time * flowSpeed, 1.0);
    vColor = vec3(
        0.0,
        0.5 + 0.5 * sin(phase * 6.28318),
        1.0
    );
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FILTER_CONNECTION_FRAGMENT_SHADER = `
varying float vSegment;
varying vec3 vColor;

void main() {
    // Pulsing glow
    float glow = sin(vSegment * 0.5) * 0.5 + 0.5;
    
    gl_FragColor = vec4(vColor * (0.5 + glow * 0.5), 0.8);
}
`;

// ============================================================================
// CHIP DIE HEATMAP SHADER
// ============================================================================

export const DIE_HEATMAP_VERTEX_SHADER = `
uniform sampler2D activityMap;
varying vec2 vUv;
varying vec3 vColor;
varying float vActivity;

void main() {
    vUv = uv;
    
    // Sample activity texture
    vec4 activity = texture2D(activityMap, uv);
    vActivity = activity.r;
    
    // Heatmap color (blue -> cyan -> yellow -> red)
    if(vActivity < 0.25) {
        vColor = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.5, 1.0), vActivity * 4.0);
    } else if(vActivity < 0.5) {
        vColor = mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 1.0), (vActivity - 0.25) * 4.0);
    } else if(vActivity < 0.75) {
        vColor = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 1.0, 0.0), (vActivity - 0.5) * 4.0);
    } else {
        vColor = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (vActivity - 0.75) * 4.0);
    }
    
    // Displace surface based on activity
    vec3 pos = position + normal * vActivity * 0.3;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const DIE_HEATMAP_FRAGMENT_SHADER = `
varying vec2 vUv;
varying vec3 vColor;
varying float vActivity;

void main() {
    // Grid overlay
    vec2 grid = abs(fract(vUv * 32.0) - 0.5);
    float gridLine = step(0.48, max(grid.x, grid.y));
    
    // Combine heatmap with grid
    vec3 color = vColor * (1.0 - gridLine * 0.3);
    
    // Emissive glow
    vec3 emissive = vColor * vActivity * 0.5;
    
    gl_FragColor = vec4(color + emissive, 1.0);
}
`;

// ============================================================================
// SHADER UTILITY FUNCTIONS
// ============================================================================

export const createShaderMaterial = (vertexShader, fragmentShader, uniforms) => {
    return {
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    };
};

export const createPostProcessComposer = (renderer, scene, camera) => {
    // Note: In real implementation, use THREE.EffectComposer
    // This is a placeholder structure
    return {
        renderer,
        scene,
        camera,
        passes: []
    };
};
