/**
 * クロマキーフィルタ
 * グリーンバック（または指定色）を透過させるPixiJSカスタムフィルタ
 * 高品質な処理：色相ベースの判定 + スピル除去（緑のエッジ残り除去）
 */
import { Filter, GlProgram } from 'pixi.js';

// 頂点シェーダー（標準的なもの）
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

// フラグメントシェーダー（高品質クロマキー処理）
const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uKeyColor;      // キーとなる色（RGB 0-1）
uniform float uThreshold;    // 色の許容範囲
uniform float uSmoothing;    // エッジのスムージング
uniform float uSpillRemoval; // スピル除去強度

// RGBからHSVに変換
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    
    // 元の色をHSVに変換
    vec3 hsv = rgb2hsv(color.rgb);
    vec3 keyHsv = rgb2hsv(uKeyColor);
    
    // 色相の差を計算（緑の色相: 約0.33）
    float hueDiff = abs(hsv.x - keyHsv.x);
    // 色相は円環なので、0.5以上の差は反対側からの距離として計算
    hueDiff = min(hueDiff, 1.0 - hueDiff);
    
    // 緑色の強さ（緑チャンネルが赤青より大きいほど緑っぽい）
    float greenDominance = color.g - max(color.r, color.b);
    
    // 彩度（高いほど鮮やか）
    float saturation = hsv.y;
    
    // ===== 肌色保護 =====
    // 肌色は赤が比較的高く（R > 0.5）、彩度は中〜低め
    // 赤みがある色は透過しない
    float skinProtect = smoothstep(0.35, 0.55, color.r);
    
    // ===== 純粋な緑のみを透過 =====
    float greenScore = 0.0;
    
    // 1. キー色との直接距離（最も信頼できる）
    float dist = distance(color.rgb, uKeyColor);
    float distScore = 1.0 - smoothstep(0.0, uThreshold, dist);
    greenScore = distScore;
    
    // 2. 色相ベースのスコア（緑の色相に近く、彩度が高い場合のみ）
    float hueScore = 1.0 - smoothstep(0.0, uThreshold * 0.25, hueDiff);
    float dominanceScore = smoothstep(0.15, 0.4, greenDominance);
    float satScore = smoothstep(0.5, 0.8, saturation);
    float hueBasedScore = hueScore * dominanceScore * satScore;
    greenScore = max(greenScore, hueBasedScore);
    
    // 3. 純粋な緑判定（G が非常に高く、R と B が低い場合）
    float pureGreen = step(0.7, color.g) * step(color.r, 0.4) * step(color.b, 0.4);
    greenScore = max(greenScore, pureGreen * 0.95);
    
    // 肌色保護を適用（赤みがある部分はスコアを下げる）
    greenScore = greenScore * (1.0 - skinProtect * 0.9);
    
    // スムージングを適用したアルファ値を計算
    float alpha = 1.0 - smoothstep(0.25, 0.25 + uSmoothing, greenScore);
    
    // スピル除去（エッジ部分の緑被りを軽減）
    vec3 despilledColor = color.rgb;
    if (uSpillRemoval > 0.0 && greenDominance > 0.0 && alpha < 1.0) {
        // 緑の過剰分を除去（ただし肌色保護を考慮）
        float spillAmount = greenDominance * uSpillRemoval * (1.0 - alpha) * (1.0 - skinProtect);
        despilledColor.g = max(0.0, color.g - spillAmount);
        // 少し明度を補正
        despilledColor.r = min(1.0, color.r + spillAmount * 0.05);
        despilledColor.b = min(1.0, color.b + spillAmount * 0.05);
    }
    
    // 出力（通常アルファ）
    float outA = color.a * alpha;
    finalColor = vec4(despilledColor * outA, outA);
}
`;

export interface ChromaKeyFilterOptions {
  /** キーとなる色 (hex値、例: 0x00FF00) */
  keyColor?: number;
  /** 色の許容範囲 (0-1、デフォルト: 0.4) */
  threshold?: number;
  /** エッジのスムージング (0-1、デフォルト: 0.15) */
  smoothing?: number;
  /** スピル除去強度 (0-1、デフォルト: 0.8) */
  spillRemoval?: number;
}

/**
 * クロマキーフィルタクラス
 * 指定した色を透過させる（高品質処理）
 */
export class ChromaKeyFilter extends Filter {
  private _keyColor: number;
  private _threshold: number;
  private _smoothing: number;
  private _spillRemoval: number;

  constructor(options: ChromaKeyFilterOptions = {}) {
    const {
      keyColor = 0x00FF00, // デフォルト: 緑
      threshold = 0.4,
      smoothing = 0.15,
      spillRemoval = 0.8,
    } = options;

    const glProgram = GlProgram.from({
      vertex,
      fragment,
      name: 'chroma-key-filter',
    });

    super({
      glProgram,
      resources: {
        chromaKeyUniforms: {
          uKeyColor: { value: [0, 1, 0], type: 'vec3<f32>' },
          uThreshold: { value: threshold, type: 'f32' },
          uSmoothing: { value: smoothing, type: 'f32' },
          uSpillRemoval: { value: spillRemoval, type: 'f32' },
        },
      },
    });

    this._keyColor = keyColor;
    this._threshold = threshold;
    this._smoothing = smoothing;
    this._spillRemoval = spillRemoval;

    // 初期色を設定
    this.keyColor = keyColor;
  }

  /** キーとなる色（透過させる色） */
  get keyColor(): number {
    return this._keyColor;
  }

  set keyColor(value: number) {
    this._keyColor = value;
    // hex値をRGB（0-1）に変換
    const r = ((value >> 16) & 0xFF) / 255;
    const g = ((value >> 8) & 0xFF) / 255;
    const b = (value & 0xFF) / 255;
    this.resources.chromaKeyUniforms.uniforms.uKeyColor = [r, g, b];
  }

  /** 色の許容範囲 */
  get threshold(): number {
    return this._threshold;
  }

  set threshold(value: number) {
    this._threshold = value;
    this.resources.chromaKeyUniforms.uniforms.uThreshold = value;
  }

  /** エッジのスムージング */
  get smoothing(): number {
    return this._smoothing;
  }

  set smoothing(value: number) {
    this._smoothing = value;
    this.resources.chromaKeyUniforms.uniforms.uSmoothing = value;
  }

  /** スピル除去強度 */
  get spillRemoval(): number {
    return this._spillRemoval;
  }

  set spillRemoval(value: number) {
    this._spillRemoval = value;
    this.resources.chromaKeyUniforms.uniforms.uSpillRemoval = value;
  }
}

// デフォルトのグリーンバック用フィルタを作成するヘルパー
export function createGreenScreenFilter(threshold = 0.4, smoothing = 0.15, spillRemoval = 0.8): ChromaKeyFilter {
  return new ChromaKeyFilter({
    keyColor: 0x00FF00, // RGB(0, 255, 0)
    threshold,
    smoothing,
    spillRemoval,
  });
}
