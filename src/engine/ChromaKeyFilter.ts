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
    
    // 彩度も考慮（彩度が高いほど色がはっきり）
    float saturation = hsv.y;
    
    // 緑と判定する条件を複合的に評価
    // 1. 色相が緑に近い
    // 2. 緑チャンネルが支配的
    // 3. 彩度がある程度高い
    float greenScore = 0.0;
    
    // 色相ベースのスコア（緑の色相に近いほど高い）
    float hueScore = 1.0 - smoothstep(0.0, uThreshold * 0.3, hueDiff);
    
    // 緑支配度スコア（緑が他より強いほど高い）
    float dominanceScore = smoothstep(-0.1, 0.2, greenDominance);
    
    // 彩度スコア（グリーンバックは通常高彩度）
    float satScore = smoothstep(0.2, 0.5, saturation);
    
    // キー色との直接距離
    float dist = distance(color.rgb, uKeyColor);
    float distScore = 1.0 - smoothstep(0.0, uThreshold, dist);
    
    // 総合スコア（複数の指標を組み合わせ）
    greenScore = max(distScore, hueScore * dominanceScore * satScore);
    
    // 薄い緑（低彩度寄り）も拾う追加スコア
    // greenが赤青平均より高いほどスコア↑（淡いグリーンバックの残り対策）
    float greenDominanceSoft = color.g - 0.5 * (color.r + color.b);
    float softScore = smoothstep(0.02, 0.18, greenDominanceSoft) * smoothstep(0.20, 0.70, color.g);
    greenScore = max(greenScore, softScore * 0.9);
    
    // スムージングを適用したアルファ値を計算（淡い緑も消えるよう少し強め）
    float alpha = 1.0 - smoothstep(0.15, 0.15 + uSmoothing, greenScore);
    
    // スピル除去（エッジ部分の緑被りを軽減）
    vec3 despilledColor = color.rgb;
    if (uSpillRemoval > 0.0 && greenDominance > 0.0) {
        // 緑の過剰分を除去
        float spillAmount = greenDominance * uSpillRemoval * (1.0 - alpha);
        despilledColor.g = color.g - spillAmount;
        // 少し明度を補正
        despilledColor.r = min(1.0, color.r + spillAmount * 0.1);
        despilledColor.b = min(1.0, color.b + spillAmount * 0.1);
    }

    // さらに淡いエッジの緑を抑える（alphaが下がるほど強く）
    if (uSpillRemoval > 0.0) {
      float edge = clamp(1.0 - alpha, 0.0, 1.0);
      float avgRB = (despilledColor.r + despilledColor.b) * 0.5;
      float targetG = min(despilledColor.g, avgRB);
      despilledColor.g = mix(despilledColor.g, targetG, edge * uSpillRemoval);
    }
    
    // 出力はプレマルチアルファにしてフリンジ（薄緑の縁）を減らす
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
