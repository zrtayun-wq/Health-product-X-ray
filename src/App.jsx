import React, { useState, useRef, useEffect } from "react";
import {
  Camera,
  Focus,
  ScanLine,
  History,
  Settings,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  AlertOctagon,
  Skull,
  Leaf,
  FlaskConical,
  Ban,
  Globe,
  BadgeCheck,
  Gauge,
  Users,
  UserX,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Info,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Heart,
  Clock,
  Image as ImageIcon,
  Siren,
  Eye,
  Droplets,
} from "lucide-react";

/* ============================================================================
 * Supplement Lens (保健品透視鏡) — v3.0【真實 API 串接與狀態管理】
 * ============================================================================
 *
 * 【v3.0 更新 — 真實資料流(Google Gemini 版)】
 *   1. fileToBase64():拍照/選圖後,以 canvas 壓縮(長邊 ≤1568px)並轉為
 *      Base64 + 正確 MIME type,符合 Gemini inline_data 的格式要求。
 *   2. analyzeWithGemini():以 fetch 呼叫 Google Gemini 3.5 Flash REST API
 *      (免費額度友善),並以 response_mime_type: "application/json" +
 *      responseSchema 雙重鎖定,強制回傳與 UI 結構 100% 一致的 JSON。
 *   3. System Prompt 內建「黑名單/品類錯位偵測 + 黃金標準比對」完整邏輯。
 *   4. 回傳結果以 useState 驅動畫面,並自動寫入歷史紀錄。
 *   5. 等待期間顯示全螢幕「AI 正在解析成分與比對資料庫...」Loading 遮罩。
 *   6. 未填 API Key 時自動退回 Demo 模式(播放 Mock Data),介面照常可展示。
 *
 * ⚠️【正式上線前必讀 — 安全警告】
 *   本檔為了在 CodeSandbox 快速測試,把 API Key 放在前端常數中。
 *   這意味著任何打開 DevTools 的人都能偷走你的 Key 並盜刷額度!
 *   正式版務必:前端只上傳圖片 → 你自己的後端 (如 /api/analyze) 持有
 *   Key 並轉發請求 → 回傳 JSON 給前端。以下 analyzeWithGemini() 的
 *   fetch 邏輯可原封不動搬到後端 (Node/Edge Function) 使用。
 *
 * ============================================================================
 * 【Vision API 串接指南 — GPT-4o Vision / Claude Vision】
 * ============================================================================
 *
 * ── 步驟 1:前端取得影像 ──────────────────────────────────────────────
 *
 * 本檔已實作真實檔案選擇器(見 <CameraViewfinder> 的兩個 hidden input)。
 * 使用者選圖後,將 File 物件轉 base64:
 *
 *   const base64 = await new Promise((res) => {
 *     const r = new FileReader();
 *     r.onload = () => res(r.result.split(",")[1]);
 *     r.readAsDataURL(file);
 *   });
 *
 *   ⚠️ 上傳前建議用 canvas 壓縮(長邊 ≤ 1568px、JPEG quality 0.8),
 *      可省下大量 token 成本,OCR 準確度幾乎不受影響。
 *
 * ── 步驟 2:後端呼叫 Vision API(API Key 只存後端環境變數!)──────────
 *
 *   // Claude (Anthropic Messages API):
 *   const response = await fetch("https://api.anthropic.com/v1/messages", {
 *     method: "POST",
 *     headers: {
 *       "Content-Type": "application/json",
 *       "x-api-key": process.env.ANTHROPIC_API_KEY,
 *       "anthropic-version": "2023-06-01",
 *     },
 *     body: JSON.stringify({
 *       model: "claude-sonnet-4-6",
 *       max_tokens: 3000,
 *       system: SYSTEM_PROMPT,   // 見步驟 3
 *       messages: [{
 *         role: "user",
 *         content: [
 *           { type: "image", source: { type: "base64",
 *             media_type: "image/jpeg", data: base64 } },
 *           { type: "text", text: "請分析這張保健食品成分標示照片。" },
 *         ],
 *       }],
 *     }),
 *   });
 *
 *   // GPT-4o 差異:content 內改用
 *   // { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } }
 *
 * ── 步驟 3:System Prompt 設計(v2.0 新增「黑名單/異常成分比對」)─────
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ 你是保健食品成分分析專家。使用者會上傳保健食品包裝或成分表照片。       │
 * │ 請執行以下任務,並「只回傳 JSON,不含任何 markdown 或其他文字」:      │
 * │                                                                       │
 * │ 1. OCR:辨識產品名稱、產地、認證標章、全成分表、劑量標示。            │
 * │ 2. 品類判定 + 黃金標準比對:                                          │
 * │    - 蔓越莓 → 前花青素 PACs ≥ 36mg/日 (DMAC 法)                      │
 * │    - 魚油   → EPA+DHA 濃度 ≥ 80%,總量 ≥ 1000mg/日                   │
 * │    - 葉黃素 → 游離型葉黃素 6~10mg/日                                 │
 * │    - 益生菌 → 明確菌株編號 (如 LGG),活菌數 ≥ 100 億 CFU              │
 * │ 3. 信任度判定 verdict:"pass" / "caution" / "fail"                    │
 * │ 4. 成分分類:"natural" / "additive" / "allergen",各附白話說明。      │
 * │                                                                       │
 * │ 5. ★★ 黑名單 / 異常成分比對(v2.0 核心)★★                          │
 * │    逐一比對成分表與以下「黑名單資料庫」,並執行「品類錯位偵測」:      │
 * │                                                                       │
 * │    (a) 絕對黑名單(任何品類出現都要警告):                            │
 * │        - 番瀉葉/番瀉苷 Sennosides → 刺激性瀉藥,偽造「排毒順暢」      │
 * │        - 西布曲明 Sibutramine → 已下架減肥藥,心血管風險              │
 * │        - 酚酞 Phenolphthalein → 致癌疑慮瀉藥,多國禁用                │
 * │        - 犀利士/威而鋼類似物 (Tadalafil analogs) → 非法摻藥          │
 * │    (b) 品類錯位偵測(成分合法,但「不該出現在這個品類」):            │
 * │        - 益生菌/酵素產品中出現瀉藥類 (番瀉葉、氧化鎂高劑量、蘆薈素)  │
 * │          → 效果來自瀉藥而非益生菌,屬欺瞞性配方                       │
 * │        - 提神/減重產品中出現未標示咖啡因來源                          │
 * │    (c) 每筆命中須回傳:成分名、危害機制白話說明、長期食用風險、        │
 * │        嚴重等級 severity: "critical" | "warning"                      │
 * │                                                                       │
 * │    JSON 欄位 toxicAlert:                                              │
 * │    { "detected": true/false,                                          │
 * │      "items": [{ "name", "reason",      ← 為什麼不該出現在這裡        │
 * │                  "harm",                ← 長期食用的潛在危害          │
 * │                  "severity" }] }                                      │
 * │                                                                       │
 * │ 6. 若照片模糊無法辨識 → { "error": "IMAGE_UNCLEAR" }                  │
 * │ JSON Schema 必須完全符合下方 MOCK 結構。                              │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * 💡 黑名單工程建議:
 *   - 黑名單資料庫(含 TFDA 公告違規名單)存在後端 DB,呼叫時動態注入
 *     Prompt,由法規/營養師團隊維護更新,不必動 Prompt 主體。
 *   - 除了讓 AI 比對,後端收到 JSON 後應「再跑一次程式碼層級的字串比對」
 *     做雙重防護(AI 可能漏抓,黑名單命中屬於安全關鍵,不能只靠 LLM)。
 *   - Claude 可用 prefill({ role:"assistant", content:"{" })強制輸出 JSON;
 *     GPT-4o 可用 response_format: { type: "json_schema", ... } 保證合法。
 *
 * ── 步驟 4:後端解析 ─────────────────────────────────────────────────
 *   const raw = data.content.map(b => b.text || "").join("");
 *   const result = JSON.parse(raw.replace(/```json|```/g, "").trim());
 *   // 建議用 zod 驗證 schema;若 toxicAlert.detected 為 true,
 *   // 可同步寫入後台通報系統,累積黑心產品資料庫。
 * ============================================================================ */

// ═══════════════════════════════════════════════════════════════════════
// ★★★ v3.0 API 層 ★★★
// ═══════════════════════════════════════════════════════════════════════

// ┌─────────────────────────────────────────────────────────────────────┐
// │ 🔑🔑🔑 【替換 API Key】就是這裡!🔑🔑🔑                                │
// │ 前往 https://aistudio.google.com/apikey 免費建立 Key 後貼入下方。     │
// │ (Google AI Studio 免費層即可,gemini-3.5-flash 有免費額度)           │
// │ 填入後,拍照/選圖就會走真實的 Gemini Vision 分析;                     │
// │ 保持原樣則自動以 Demo 模式播放 Mock Data,方便展示 UI。                │
// └─────────────────────────────────────────────────────────────────────┘
// 優先讀取 .env.local 的環境變數(推薦);也可直接把 Key 貼在後方字串
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "請在這裡填入你的 Google API Key";

// Gemini REST API 端點(gemini-3.5-flash:Google 最新 Flash 模型,支援 Vision 與思考等級控制)
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// 判斷使用者是否已填入 Key(未填 → Demo 模式;Google API Key 以 "AIza" 開頭)
const isApiKeyConfigured = () =>
  GEMINI_API_KEY && !GEMINI_API_KEY.includes("請在這裡") && GEMINI_API_KEY.length > 20;

// ─── System Prompt:黃金標準比對 + 黑名單偵測(產品的靈魂)──────────────
const SYSTEM_PROMPT = `你是保健食品成分分析專家。使用者會上傳保健食品包裝或成分表的照片。
請以繁體中文執行以下分析,並嚴格依照指定的 JSON Schema 回傳結果:

【任務 1:OCR 辨識】
辨識產品名稱、品牌、生產國家(countryFlag 填該國 emoji 國旗)、認證標章、全成分表、劑量標示。
認證標章需查核真偽:若包裝宣稱「FDA 認證」但保健食品實際上只有 FDA 廠房登記而非產品認證,
verified 應為 false 並在 note 說明;真實可驗證的認證(SGS、GMP、IFOS 等)verified 為 true。

【任務 2:品類判定與黃金標準比對】
判斷產品品類,並比對該品類的「臨床黃金標準指標」:
- 蔓越莓 → 前花青素 PACs ≥ 36mg/日 (DMAC 檢測法)。注意:「蔓越莓果汁粉/濃縮粉」重量 ≠ PACs 含量!
- 魚油 → EPA+DHA 濃度 ≥ 80%,每日總量 ≥ 1000mg,優先 rTG 型
- 葉黃素 → 游離型葉黃素 6~10mg/日 (AREDS2 配方)
- 益生菌 → 必須標示菌株編號 (如 LGG、BB-12),活菌數 ≥ 100 億 CFU
- 消化酵素 → 必須標示活性單位 (HUT、DU 等),僅標重量 mg 屬標示不透明
- 膠原蛋白 → 分子量 ≤ 3000 Da 水解型,每日 5~10g
- 維生素D → D3 型式,400~2000 IU/日
- 其他品類 → 依營養學共識自行判定該品類最關鍵的有效性指標

信任度判定 verdict:
- "pass"    → 核心指標明確標示且達臨床標準
- "caution" → 有標示但濃度偏低、或標示模糊無法評估
- "fail"    → 完全未標示核心指標(高機率為行銷噱頭)
warningText 請用一句白話文寫出結論,fail 時語氣需具警示感。

【任務 3:黑名單 / 異常成分比對(安全關鍵)】
逐一比對成分表,執行兩層檢查:
(a) 絕對黑名單(任何品類出現都必須警告,severity: "critical"):
    - 番瀉葉/番瀉苷 (Sennosides) → 刺激性瀉藥,偽造「排毒順暢」假象,
      長期依賴導致腸道黑變病與自主蠕動能力喪失
    - 西布曲明 (Sibutramine) → 已全球下架的減肥藥,心血管風險
    - 酚酞 (Phenolphthalein) → 致癌疑慮瀉藥,多國禁用
    - 西地那非/他達拉非類似物 → 非法摻藥,與硝酸鹽類藥物併用可致命
    - 未標示的類固醇、利尿劑成分
(b) 品類錯位偵測(成分本身合法,但不該出現在這個品類,severity: "warning"):
    - 益生菌/酵素/排便相關產品中出現瀉藥類(番瀉葉、蘆薈素、高劑量氧化鎂)
      → 效果來自瀉藥而非標榜成分,屬欺瞞性配方
    - 提神/減重產品中出現未明確標示劑量的咖啡因來源
每筆命中須填寫:name(成分名)、reason(為什麼不該出現在這裡,白話)、
harm(長期食用的潛在危害,白話)、severity。
命中黑名單的成分,在 ingredients 中 type 必須標為 "toxic"。
無任何異常時 detected 為 false、items 為空陣列。

【任務 4:成分白話分類】
每項成分歸入 type:"natural"(天然/安全)、"additive"(化學添加/防腐/填充)、
"allergen"(常見過敏原,如大豆、麩質、乳糖、魚類)、"toxic"(黑名單命中)。
plainText 用一句消費者聽得懂的白話說明它的實際作用(可以幽默但要準確)。

【任務 5:劑量白話文與受眾】
dosage:dailyNeed 填該核心成分的每日建議量、actualAmount 填此產品推估實際提供量
(單位一致);plainTalk 固定回答三個問題:「這個濃度在市場上算高還是低?」
「吃了能彌補日常飲食的什麼不足?」「為什麼你需要吃這個?」——誠實回答,
若產品不值得買就直說。
audience:suitable 的 icon 只能從 "clock"/"heart"/"zap" 三選一;
unsuitable 必須涵蓋藥物交互作用與特殊族群(孕婦等),若含黑名單成分,
第一條必須警告所有人避免。

【任務 6:照片品質檢查】
若照片模糊、反光或根本不是保健食品,將 imageUnclear 設為 true,
其餘欄位填入空字串/空陣列/0 即可。

語言:全部使用繁體中文(台灣用語)。`;

// ─── Gemini responseSchema(OpenAPI 3.0 子集格式,型別為大寫)──────────
// Gemini 的雙重鎖定:responseMimeType 強制輸出純 JSON(無 markdown 圍欄),
// responseSchema 進一步約束結構與 enum 值 → 回傳保證與 UI 需要的格式一致。
// 注意:Gemini 的 schema 格式與 OpenAI 不同 — 型別大寫、用 nullable 而非
// union type、不需要 additionalProperties/strict。
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["imageUnclear", "basicInfo", "coreCheck", "toxicAlert", "ingredients", "dosage", "audience"],
  properties: {
    imageUnclear: { type: "BOOLEAN", description: "照片模糊或非保健食品時為 true" },
    basicInfo: {
      type: "OBJECT",
      required: ["name", "brand", "country", "countryFlag", "certifications"],
      properties: {
        name: { type: "STRING" },
        brand: { type: "STRING" },
        country: { type: "STRING" },
        countryFlag: { type: "STRING" },
        certifications: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            required: ["label", "verified"],
            properties: {
              label: { type: "STRING" },
              verified: { type: "BOOLEAN" },
              note: { type: "STRING", nullable: true, description: "verified 為 false 時說明原因" },
            },
          },
        },
      },
    },
    coreCheck: {
      type: "OBJECT",
      required: ["category", "goldStandard", "goldStandardDesc", "clinicalThreshold", "actualLabel", "actualDetail", "verdict", "warningText"],
      properties: {
        category: { type: "STRING" },
        goldStandard: { type: "STRING" },
        goldStandardDesc: { type: "STRING" },
        clinicalThreshold: { type: "STRING" },
        actualLabel: { type: "STRING" },
        actualDetail: { type: "STRING" },
        verdict: { type: "STRING", enum: ["pass", "caution", "fail"] },
        warningText: { type: "STRING" },
      },
    },
    toxicAlert: {
      type: "OBJECT",
      required: ["detected", "items"],
      properties: {
        detected: { type: "BOOLEAN" },
        items: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            required: ["name", "severity", "reason", "harm"],
            properties: {
              name: { type: "STRING" },
              severity: { type: "STRING", enum: ["critical", "warning"] },
              reason: { type: "STRING" },
              harm: { type: "STRING" },
            },
          },
        },
      },
    },
    ingredients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["name", "type", "plainText"],
        properties: {
          name: { type: "STRING" },
          type: { type: "STRING", enum: ["natural", "additive", "allergen", "toxic"] },
          plainText: { type: "STRING" },
        },
      },
    },
    dosage: {
      type: "OBJECT",
      required: ["nutrientName", "dailyNeed", "actualAmount", "unit", "plainTalk"],
      properties: {
        nutrientName: { type: "STRING" },
        dailyNeed: { type: "NUMBER" },
        actualAmount: { type: "NUMBER" },
        unit: { type: "STRING" },
        plainTalk: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            required: ["q", "a"],
            properties: { q: { type: "STRING" }, a: { type: "STRING" } },
          },
        },
      },
    },
    audience: {
      type: "OBJECT",
      required: ["suitable", "unsuitable"],
      properties: {
        suitable: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            required: ["icon", "label"],
            properties: {
              icon: { type: "STRING", enum: ["clock", "heart", "zap"] },
              label: { type: "STRING" },
            },
          },
        },
        unsuitable: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            required: ["label", "reason"],
            properties: { label: { type: "STRING" }, reason: { type: "STRING" } },
          },
        },
      },
    },
  },
};

// ─── 步驟 1:圖片轉 Base64 + 正確 MIME type(Gemini inline_data 格式)────
// canvas 壓縮:長邊縮至 ≤1568px、JPEG quality 0.85 → OCR 準確度幾乎不變,
// token 成本與上傳時間可下降 5~10 倍。
// 回傳 { base64, mimeType } — Gemini 的 inline_data 需要兩者配對正確。
async function fileToBase64(file, maxEdge = 1568, quality = 0.85) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("照片讀取失敗,請重新選擇"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("照片格式無法解析"));
    image.src = dataUrl;
  });

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));

  // 尺寸已達標且是 Gemini 支援的格式 → 直接回傳原圖(保留原 MIME type)
  const supported = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (scale === 1 && supported.includes(file.type)) {
    return { base64: dataUrl.split(",")[1], mimeType: file.type };
  }

  // 需要壓縮或格式不支援 → 一律經 canvas 重繪並轉為 JPEG
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    base64: canvas.toDataURL("image/jpeg", quality).split(",")[1],
    mimeType: "image/jpeg",
  };
}

// ─── 步驟 2:呼叫 Google Gemini 3.5 Flash(v3.1 穩定度強化版)──────────
// ─────────────────────────────────────────────────────────────────────────
// 【強化 1】字串清洗:把 markdown 圍欄與 JSON 前後的雜訊全部清乾淨
// ─────────────────────────────────────────────────────────────────────────
function cleanJsonText(raw) {
  let text = (raw || "").trim();

  // (a) 去除頭尾的 ```json / ``` 圍欄(含大小寫與換行變體)
  text = text.replace(/^```(?:json|JSON)?\s*/m, "").replace(/```\s*$/m, "");

  // (b) 保險起見,只取「第一個 { 到最後一個 }」之間的內容,
  //     順手切掉模型可能加在 JSON 前後的說明文字
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    text = text.slice(first, last + 1);
  } else if (first !== -1) {
    // 找得到開頭但找不到結尾 → JSON 被截斷,先取到底,交給修復函數處理
    text = text.slice(first);
  }
  return text.trim();
}

// ─────────────────────────────────────────────────────────────────────────
// 【強化 2】截斷修復:JSON 在中途被切斷時,自動補上未閉合的引號與括號
// 原理:逐字元掃描,追蹤「是否在字串內」與「未閉合的 { [ 堆疊」,
// 掃到結尾後把缺的部分反向補齊,讓 JSON.parse 有機會救回大部分資料。
// ─────────────────────────────────────────────────────────────────────────
function repairTruncatedJson(text) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  let repaired = text;
  // 結尾若停在字串中間(Unterminated string)→ 補上收尾引號
  if (inString) repaired += '"';
  // 去掉可能懸空的結尾逗號(如 "xxx", 之後就沒了)
  repaired = repaired.replace(/,\s*$/, "");
  // 依堆疊反向補齊所有未閉合的括號
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === "{" ? "}" : "]";
  }
  return repaired;
}

// ─────────────────────────────────────────────────────────────────────────
// 【強化 3】安全降級:parse 徹底失敗時回傳的預設結構,
// 完全符合 UI 需要的 Schema,讓卡片照常渲染而不是整個 App 白屏崩潰
// ─────────────────────────────────────────────────────────────────────────
const INCOMPLETE_ANALYSIS_FALLBACK = {
  imageUnclear: false,
  basicInfo: {
    name: "分析不完整,請重新拍攝",
    brand: "AI 回傳資料異常",
    country: "未知",
    countryFlag: "❓",
    certifications: [],
  },
  coreCheck: {
    category: "無法判定",
    goldStandard: "—",
    goldStandardDesc: "AI 回傳的資料不完整,無法進行黃金標準比對",
    clinicalThreshold: "—",
    actualLabel: "資料不完整",
    actualDetail: "本次分析的回傳內容被截斷或格式異常,以下結果不可作為參考。",
    verdict: "caution",
    warningText: "分析不完整,請重新拍攝:對準成分標示、避免反光與手震後再試一次",
  },
  toxicAlert: { detected: false, items: [] },
  ingredients: [],
  dosage: {
    nutrientName: "—",
    dailyNeed: 1, // 設 1 避免進度條除以零
    actualAmount: 0,
    unit: "",
    plainTalk: [
      { q: "發生了什麼事?", a: "AI 回傳的 JSON 不完整,系統已自動攔截,避免顯示錯誤資訊。" },
      { q: "我該怎麼做?", a: "請重新拍攝:靠近成分標示、光線充足、避免反光,成功率會大幅提升。" },
      { q: "會被重複扣額度嗎?", a: "每次請求都會計入 Gemini 免費額度,但免費層額度相當充裕,放心重試。" },
    ],
  },
  audience: { suitable: [], unsuitable: [] },
};

// ─────────────────────────────────────────────────────────────────────────
// 呼叫 Google Gemini 3.5 Flash(v3.1 穩定度強化版)
// ⚠️ 正式版請把這整個函數搬到你的後端,前端改為 fetch("/api/analyze")
// ─────────────────────────────────────────────────────────────────────────
// ─── 呼叫分析服務(v4.0 雙模式)────────────────────────────────────────
// 模式 A(本地開發):.env.local 有 VITE_GEMINI_API_KEY → 前端直連 Gemini
// 模式 B(正式部署):前端無 Key → 呼叫自家後端 /api/analyze,
//                    Key 只存在 Vercel 環境變數,DevTools 完全看不到
async function analyzeWithGemini({ base64, mimeType }) {
  if (!isApiKeyConfigured()) {
    // ── 模式 B:走後端 Serverless Function ──
    // AbortController 逾時保護:60 秒沒回應就中止,絕不無限轉圈
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let res;
    try {
      res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mimeType }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === "AbortError") {
        throw new Error("分析逾時(超過 60 秒),請檢查網路後重試");
      }
      const err = new Error("無法連線到分析服務");
      err.code = "NO_ANALYZER";
      throw err;
    }
    clearTimeout(timeout);
    if (res.status === 404) {
      // 本地 npm run dev 沒有 /api 路由 → 交給呼叫端退回 Demo 模式
      const err = new Error("後端分析服務不存在");
      err.code = "NO_ANALYZER";
      throw err;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `分析服務錯誤 (${res.status})`);
    return data;
  }

  // ── 模式 A:前端直連 Gemini(僅限本地開發)──
  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: "請分析這張保健食品照片,依 Schema 回傳完整 JSON。" },
          ],
        },
      ],
      generationConfig: {
        // ★★【截斷問題的真正解法】Gemini 3.5 Flash 是推理模型,
        //    「思考 token」會計入 maxOutputTokens!設 2048 的話,思考就
        //    吃掉大半額度,JSON 寫到一半被切斷 → Unterminated string。
        //    因此上限開到 8192(模型輸出上限 64K,綽綽有餘),
        //    並將思考等級壓到 low:結構化抽取任務不需要深度推理,
        //    low 更快、更省、也把額度留給 JSON 本體。
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: "low" },
        // 強制輸出純 JSON(無 markdown 圍欄)+ 結構鎖定
        response_mime_type: "application/json",
        response_schema: GEMINI_RESPONSE_SCHEMA,
        // 注意:Gemini 3.x 官方強烈建議「不要」自訂 temperature/topP/topK,
        // 推理模型已針對預設值最佳化,故此處不再帶 temperature 參數。
      },
      safetySettings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ],
    }),
  });

  // ── HTTP 層錯誤處理 ──
  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    const msg = errBody?.error?.message || "";
    if (response.status === 400 && msg.toLowerCase().includes("api key")) {
      throw new Error("API Key 無效,請確認頂部 GEMINI_API_KEY 是否正確填入");
    }
    if (response.status === 429) {
      throw new Error("已達免費額度上限或請求過於頻繁,請稍後再試");
    }
    throw new Error(`AI 服務暫時無法回應 (${response.status})${msg ? `:${msg}` : ""}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];

  if (candidate?.finishReason === "SAFETY") {
    throw new Error("照片內容被安全過濾器攔截,請改拍成分標示區域");
  }

  const rawText = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
  if (!rawText) throw new Error("AI 未回傳分析內容,請重試");

  // ═══════════════════════════════════════════════════════════════════
  // 三段式解析:清洗 → 直接 parse → 截斷修復 parse → 安全降級
  // ═══════════════════════════════════════════════════════════════════
  const cleaned = cleanJsonText(rawText); // 【強化 1】清掉 ```json 圍欄與雜訊

  let result = null;
  try {
    result = JSON.parse(cleaned);
  } catch (firstErr) {
    // finishReason === "MAX_TOKENS" 代表確定被截斷;其他情況也一併嘗試修復
    console.warn(
      `[Supplement Lens] 第一次 JSON.parse 失敗(finishReason: ${candidate?.finishReason || "未知"}),嘗試截斷修復…`,
      firstErr.message
    );
    try {
      result = JSON.parse(repairTruncatedJson(cleaned)); // 【強化 2】補引號補括號
      console.info("[Supplement Lens] ✅ 截斷修復成功,已救回大部分資料");
    } catch (secondErr) {
      // 【強化 3】徹底失敗 → 印出原始回傳方便 Debug,回傳降級結構,App 不崩潰
      console.error("═══ [Supplement Lens] JSON 解析徹底失敗,以下為 Gemini 原始回傳 ═══");
      console.log(rawText);
      console.error("═══ 原始回傳結束(finishReason:", candidate?.finishReason, ")═══", secondErr);
      return { ...INCOMPLETE_ANALYSIS_FALLBACK, id: `scan-fallback-${Date.now()}` };
    }
  }

  if (result.imageUnclear) {
    throw new Error("照片模糊或未拍到成分標示,請對準包裝背面的成分表重新拍攝");
  }

  // 修復後的 JSON 可能缺欄位 → 用降級結構補齊,確保每張卡片都拿得到資料
  result = {
    ...INCOMPLETE_ANALYSIS_FALLBACK,
    ...result,
    basicInfo: { ...INCOMPLETE_ANALYSIS_FALLBACK.basicInfo, ...(result.basicInfo || {}) },
    coreCheck: { ...INCOMPLETE_ANALYSIS_FALLBACK.coreCheck, ...(result.coreCheck || {}) },
    toxicAlert: { detected: false, items: [], ...(result.toxicAlert || {}) },
    ingredients: Array.isArray(result.ingredients) ? result.ingredients : [],
    dosage: { ...INCOMPLETE_ANALYSIS_FALLBACK.dosage, ...(result.dosage || {}) },
    audience: { suitable: [], unsuitable: [], ...(result.audience || {}) },
  };

  // 【安全雙重防護】黑名單命中屬安全關鍵,不能只信 LLM——
  // 程式碼層級再比對一次關鍵字,AI 漏抓也能兜底(正式版請在後端執行並擴充清單)
  const BLACKLIST_KEYWORDS = ["番瀉", "sennoside", "西布曲明", "sibutramine", "酚酞", "phenolphthalein", "西地那非", "sildenafil", "他達拉非", "tadalafil"];
  result.ingredients.forEach((ing) => {
    const hit = BLACKLIST_KEYWORDS.some((kw) => (ing.name || "").toLowerCase().includes(kw));
    if (hit && !result.toxicAlert.items.some((t) => t.name.includes(ing.name))) {
      ing.type = "toxic";
      result.toxicAlert.detected = true;
      result.toxicAlert.items.push({
        name: ing.name,
        severity: "critical",
        reason: "此成分命中系統黑名單資料庫(程式碼層級比對),不應出現在保健食品中。",
        harm: "屬於違規/高風險添加物,長期食用有健康疑慮,強烈建議避免並向食藥署通報。",
      });
    }
  });

  result.id = `scan-${Date.now()}`;
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Mock 產品資料庫(Demo 模式使用;同時是 AI 回傳 JSON 的結構範例)
// ═══════════════════════════════════════════════════════════════════════

// 產品 1:蔓越莓益生菌 — 雙重地雷(核心指標未標示 + 偷加番瀉葉)
const PRODUCT_CRANBERRY = {
  id: "cranberry-01",
  basicInfo: {
    name: "莓好時光 蔓越莓益生菌膠囊",
    brand: "某知名藥妝通路品牌",
    country: "台灣",
    countryFlag: "🇹🇼",
    certifications: [
      { label: "SGS 檢驗", verified: true },
      { label: "GMP 廠製造", verified: true },
      { label: "FDA 認證", verified: false, note: "包裝宣稱,實為廠房登記非產品認證" },
    ],
  },
  coreCheck: {
    category: "蔓越莓保健品",
    goldStandard: "前花青素 PACs",
    goldStandardDesc: "臨床研究證實有效的關鍵活性成分,私密處保養的真正主角",
    clinicalThreshold: "≥ 36 mg / 日 (DMAC 檢測法)",
    actualLabel: "未標示 PACs 含量",
    actualDetail: "僅標示「蔓越莓果汁粉 200mg」,果汁粉 ≠ 前花青素,實際 PACs 可能趨近於 0",
    verdict: "fail",
    warningText: "注意:未標示核心成分或濃度過低,可能僅為行銷噱頭,請斟酌購買",
  },
  // ★ v2.0 新增:致命踩雷警告
  toxicAlert: {
    detected: true,
    items: [
      {
        name: "番瀉葉萃取物 (Sennosides)",
        severity: "critical",
        reason:
          "這是刺激性瀉藥成分,完全不該出現在「益生菌」產品中。你感受到的「順暢」來自瀉藥刺激腸道,而非益生菌改善菌相——屬於製造假效用的欺瞞性配方。",
        harm:
          "番瀉葉是強烈瀉藥成分,常被黑心廠商用來製造「立即排毒/順暢」的假象,長期依賴會導致腸道黑變病與自主蠕動能力喪失,強烈建議避免食用!",
      },
    ],
  },
  ingredients: [
    { name: "蔓越莓果汁粉", type: "natural", plainText: "天然來源,但活性成分含量未知" },
    { name: "嗜酸乳桿菌", type: "natural", plainText: "常見益生菌,但未標示菌株編號與活菌數" },
    { name: "維生素 C", type: "natural", plainText: "抗氧化,幫助吸收" },
    { name: "番瀉葉萃取物", type: "toxic", plainText: "⚠️ 黑名單成分!刺激性瀉藥,詳見上方致命踩雷警告" },
    { name: "麥芽糊精", type: "additive", plainText: "填充物,增加體積用,無保健價值" },
    { name: "二氧化矽", type: "additive", plainText: "抗結塊劑,防止粉末結塊" },
    { name: "硬脂酸鎂", type: "additive", plainText: "潤滑劑,方便機器打錠" },
    { name: "食用色素 (紅色 40 號)", type: "additive", plainText: "人工色素,純粹讓它看起來更「莓」" },
    { name: "乳糖", type: "allergen", plainText: "乳糖不耐者請避免" },
    { name: "大豆卵磷脂", type: "allergen", plainText: "大豆過敏者請避免" },
  ],
  dosage: {
    nutrientName: "前花青素 PACs",
    dailyNeed: 36,
    actualAmount: 2,
    unit: "mg",
    plainTalk: [
      { q: "這個濃度在市場上算高還是低?", a: "極低。以果汁粉換算,PACs 可能不到臨床標準的 6%,在市場上屬於後段班。" },
      { q: "吃了能彌補日常飲食的什麼不足?", a: "幾乎無法。這個劑量約等於喝一小口蔓越莓汁,不如直接吃新鮮莓果。" },
      { q: "為什麼你需要吃這個?", a: "以此產品的標示來看——你不需要,而且含瀉藥成分,建議直接放回貨架。" },
    ],
  },
  audience: {
    suitable: [
      { icon: "clock", label: "經常久坐、憋尿的上班族" },
      { icon: "heart", label: "重視私密處日常保養的女性" },
      { icon: "zap", label: "反覆有泌尿道困擾者(需選達標產品)" },
    ],
    unsuitable: [
      { label: "所有人(本產品含黑名單瀉藥成分)", reason: "偵測到番瀉葉,不建議任何人長期食用" },
      { label: "孕婦及哺乳期女性", reason: "番瀉葉可能刺激子宮收縮,絕對禁用" },
      { label: "服用抗凝血劑 (Warfarin) 者", reason: "蔓越莓可能增強藥效,有出血風險" },
      { label: "腸胃敏感 / 腸躁症患者", reason: "瀉藥成分會加劇腹瀉與腸道刺激" },
    ],
  },
};

// 產品 2:優質魚油 — 全綠燈範例(展示「安全盾牌」狀態)
const PRODUCT_FISHOIL = {
  id: "fishoil-01",
  basicInfo: {
    name: "深海皇冠 rTG 魚油 90%",
    brand: "北歐原裝進口",
    country: "挪威",
    countryFlag: "🇳🇴",
    certifications: [
      { label: "IFOS 五星", verified: true },
      { label: "SGS 檢驗", verified: true },
      { label: "GMP 廠製造", verified: true },
    ],
  },
  coreCheck: {
    category: "魚油",
    goldStandard: "EPA + DHA 濃度",
    goldStandardDesc: "Omega-3 的有效核心,濃度與型態 (rTG) 決定吸收率",
    clinicalThreshold: "濃度 ≥ 80%,每日 ≥ 1000mg",
    actualLabel: "rTG 型 90%,每日 1200mg",
    actualDetail: "明確標示 EPA 540mg + DHA 360mg,rTG 型態吸收率佳,超越臨床標準",
    verdict: "pass",
    warningText: "核心指標清楚標示且達臨床有效標準,是誠實用料的好產品",
  },
  toxicAlert: { detected: false, items: [] },
  ingredients: [
    { name: "深海魚油 (rTG型)", type: "natural", plainText: "小型魚萃取,重金屬風險低" },
    { name: "EPA", type: "natural", plainText: "抗發炎、心血管保養主力" },
    { name: "DHA", type: "natural", plainText: "大腦與視力保養關鍵" },
    { name: "維生素 E", type: "natural", plainText: "天然抗氧化,防止魚油氧化變質" },
    { name: "明膠 (膠囊殼)", type: "additive", plainText: "軟膠囊外殼,常規安全" },
    { name: "甘油", type: "additive", plainText: "保持膠囊彈性,常規安全" },
    { name: "魚類 (過敏原)", type: "allergen", plainText: "對魚類過敏者請避免" },
  ],
  dosage: {
    nutrientName: "EPA + DHA",
    dailyNeed: 1000,
    actualAmount: 1080,
    unit: "mg",
    plainTalk: [
      { q: "這個濃度在市場上算高還是低?", a: "非常高。90% 濃度屬於市場金字塔頂端,一顆抵普通魚油三顆。" },
      { q: "吃了能彌補日常飲食的什麼不足?", a: "台灣人深海魚攝取普遍不足,這罐能有效補足 Omega-3 缺口。" },
      { q: "為什麼你需要吃這個?", a: "若你一週吃不到兩次深海魚,又在意心血管與大腦保養,這是合理的選擇。" },
    ],
  },
  audience: {
    suitable: [
      { icon: "heart", label: "在意心血管保養的中壯年族群" },
      { icon: "zap", label: "用腦量大的上班族與學生" },
      { icon: "clock", label: "外食為主、少吃深海魚者" },
    ],
    unsuitable: [
      { label: "服用抗凝血劑者", reason: "高劑量魚油有加乘出血風險,請諮詢醫師" },
      { label: "魚類過敏者", reason: "本產品原料為深海魚萃取" },
      { label: "手術前兩週", reason: "建議暫停高劑量魚油以降低出血風險" },
    ],
  },
};

// 產品 3:葉黃素 — pass 範例(供歷史回放)
const PRODUCT_LUTEIN = {
  id: "lutein-01",
  basicInfo: {
    name: "亮眼晶采 游離型葉黃素",
    brand: "專利原料 FloraGLO",
    country: "美國",
    countryFlag: "🇺🇸",
    certifications: [
      { label: "FloraGLO 專利", verified: true },
      { label: "SGS 檢驗", verified: true },
    ],
  },
  coreCheck: {
    category: "葉黃素",
    goldStandard: "游離型葉黃素含量",
    goldStandardDesc: "游離型分子小、吸收率高,是護眼有效性的關鍵",
    clinicalThreshold: "6~10 mg / 日 (AREDS2 研究)",
    actualLabel: "游離型 10mg + 玉米黃素 2mg",
    actualDetail: "採用 AREDS2 黃金比例 5:1,標示清楚透明",
    verdict: "pass",
    warningText: "核心指標達標且採臨床研究配方比例,值得信賴",
  },
  toxicAlert: { detected: false, items: [] },
  ingredients: [
    { name: "游離型葉黃素", type: "natural", plainText: "金盞花萃取,護眼主力" },
    { name: "玉米黃素", type: "natural", plainText: "與葉黃素協同保護黃斑部" },
    { name: "山桑子萃取", type: "natural", plainText: "花青素來源,輔助舒緩" },
    { name: "微晶纖維素", type: "additive", plainText: "常見賦形劑,安全" },
    { name: "大豆油 (載體)", type: "allergen", plainText: "大豆過敏者請留意" },
  ],
  dosage: {
    nutrientName: "游離型葉黃素",
    dailyNeed: 10,
    actualAmount: 10,
    unit: "mg",
    plainTalk: [
      { q: "這個濃度在市場上算高還是低?", a: "剛好達到臨床研究上限,屬於高標配置。" },
      { q: "吃了能彌補日常飲食的什麼不足?", a: "深綠色蔬菜吃不夠的人,葉黃素攝取普遍不足,這罐能補齊。" },
      { q: "為什麼你需要吃這個?", a: "長時間盯螢幕、深綠蔬菜吃得少,就是葉黃素的目標族群。" },
    ],
  },
  audience: {
    suitable: [
      { icon: "zap", label: "每日螢幕使用超過 8 小時者" },
      { icon: "clock", label: "深綠色蔬菜攝取不足者" },
    ],
    unsuitable: [
      { label: "吸菸者(高劑量 β-胡蘿蔔素配方時)", reason: "本品未含,但選購他牌時請留意" },
      { label: "大豆過敏者", reason: "本產品以大豆油為載體" },
    ],
  },
};

// 產品 4:綜合酵素 — caution 範例(供歷史回放)
const PRODUCT_ENZYME = {
  id: "enzyme-01",
  basicInfo: {
    name: "順暢每一天 綜合酵素",
    brand: "日系通路品牌",
    country: "日本",
    countryFlag: "🇯🇵",
    certifications: [{ label: "GMP 廠製造", verified: true }],
  },
  coreCheck: {
    category: "消化酵素",
    goldStandard: "酵素活性單位標示",
    goldStandardDesc: "酵素看的是「活性單位」(如 HUT、DU),不是重量 mg",
    clinicalThreshold: "應明確標示各酵素活性單位",
    actualLabel: "僅標示「綜合酵素 300mg」",
    actualDetail: "只寫重量不寫活性,無法判斷實際消化力,標示不夠透明",
    verdict: "caution",
    warningText: "標示模糊:未提供酵素活性單位,實際效果無法評估,建議選擇標示更透明的產品",
  },
  toxicAlert: { detected: false, items: [] },
  ingredients: [
    { name: "鳳梨酵素", type: "natural", plainText: "幫助蛋白質分解" },
    { name: "木瓜酵素", type: "natural", plainText: "溫和的蛋白質分解酵素" },
    { name: "乳酸菌粉", type: "natural", plainText: "未標示菌數,聊勝於無" },
    { name: "麥芽糊精", type: "additive", plainText: "填充物,無保健價值" },
    { name: "香料", type: "additive", plainText: "調味用,來源未標示" },
  ],
  dosage: {
    nutrientName: "酵素活性",
    dailyNeed: 100,
    actualAmount: 50,
    unit: "%",
    plainTalk: [
      { q: "這個濃度在市場上算高還是低?", a: "無法判斷——因為廠商根本沒標活性單位,這本身就是問題。" },
      { q: "吃了能彌補日常飲食的什麼不足?", a: "理論上輔助消化,但實際效力成謎。" },
      { q: "為什麼你需要吃這個?", a: "若常吃大餐消化不良可考慮酵素,但請選有標活性單位的品牌。" },
    ],
  },
  audience: {
    suitable: [
      { icon: "clock", label: "應酬多、常吃大餐者" },
      { icon: "zap", label: "年長後消化力下降者" },
    ],
    unsuitable: [
      { label: "鳳梨/木瓜過敏者", reason: "含相關蛋白酵素" },
      { label: "胃潰瘍患者", reason: "蛋白分解酵素可能刺激患部" },
    ],
  },
};

// 歷史紀錄:每筆綁定完整產品資料,點擊即可回放
const MOCK_HISTORY = [
  { id: 1, product: PRODUCT_CRANBERRY, date: "今天 14:32", verdict: "fail", category: "蔓越莓", hasToxic: true },
  { id: 2, product: PRODUCT_FISHOIL, date: "昨天 19:05", verdict: "pass", category: "魚油", hasToxic: false },
  { id: 3, product: PRODUCT_LUTEIN, date: "7/2 11:20", verdict: "pass", category: "葉黃素", hasToxic: false },
  { id: 4, product: PRODUCT_ENZYME, date: "6/28 16:44", verdict: "caution", category: "酵素", hasToxic: false },
];

// ═══════════════════════════════════════════════════════════════════════
// 共用元件
// ═══════════════════════════════════════════════════════════════════════

const VERDICT_CONFIG = {
  pass: { color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-500", label: "達臨床標準" },
  caution: { color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500", label: "標示模糊" },
  fail: { color: "text-red-600", bg: "bg-red-50", border: "border-red-200", dot: "bg-red-500", label: "行銷噱頭警告" },
};

function Card({ children, className = "" }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-stone-100 ${className}`}>{children}</div>;
}

function CardHeader({ icon: Icon, title, subtitle, iconBg = "bg-stone-100", iconColor = "text-stone-600" }) {
  return (
    <div className="flex items-center gap-3 px-5 pt-5 pb-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>
        <Icon className={`w-5 h-5 ${iconColor}`} strokeWidth={2.2} />
      </div>
      <div>
        <h3 className="text-[15px] font-bold text-stone-800 leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-stone-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 沉浸式相機觀景窗 (v2.0):真實檔案選擇器 + 快門/圖庫控制列
// ═══════════════════════════════════════════════════════════════════════
function CameraViewfinder({ scanState, previewUrl, onCapture, onGallery, captureInputRef, galleryInputRef, onFileSelected }) {
  return (
    <div className="relative w-full overflow-hidden" style={{ height: "min(52vh, 460px)" }}>
      {/* ── 真實檔案選擇器 ──
          快門鍵:capture="environment" 在手機上會直接喚起後鏡頭相機
          圖庫鍵:不加 capture,開啟相簿讓使用者選圖
          選好的照片會透過 URL.createObjectURL 即時顯示為觀景窗背景     */}
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileSelected}
      />
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelected} />

      {/* 深色相機底 / 或使用者選取的照片 */}
      <div className="absolute inset-0 bg-gradient-to-b from-stone-900 via-stone-800 to-stone-900" />
      {previewUrl && (
        <img
          src={previewUrl}
          alt="待辨識的產品照片"
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        />
      )}
      {/* 照片上的暗角,確保 UI 文字可讀 */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

      {/* 模擬鏡頭格線 */}
      {!previewUrl && (
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
      )}

      {/* 對焦框 */}
      <div className="absolute inset-x-0 top-0 bottom-24 flex items-center justify-center pointer-events-none">
        <div className={`relative w-56 h-56 transition-transform duration-500 ${scanState === "scanning" ? "scale-95" : "scale-100"}`}>
          {["top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg",
            "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg",
            "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg",
            "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg"].map((pos, i) => (
            <div
              key={i}
              className={`absolute w-8 h-8 ${pos} ${
                scanState === "scanning" ? "border-emerald-400" : "border-white/70"
              } transition-colors duration-300`}
            />
          ))}

          {scanState === "scanning" && (
            <div className="absolute inset-x-2 h-0.5 bg-emerald-400/90 rounded-full shadow-[0_0_12px_rgba(52,211,153,0.8)] animate-[scanline_1.4s_ease-in-out_infinite]" />
          )}

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            {scanState === "idle" && !previewUrl && (
              <>
                <Eye className="w-9 h-9 text-white/70" strokeWidth={1.8} />
                <span className="text-white/60 text-xs tracking-wide text-center px-4">
                  將成分標示對準框內
                  <br />
                  按下快門或從圖庫選圖
                </span>
              </>
            )}
            {scanState === "scanning" && (
              <>
                <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" strokeWidth={1.8} />
                <span className="text-emerald-300 text-xs tracking-wide animate-pulse">AI 辨識分析中…</span>
              </>
            )}
            {scanState === "done" && (
              <>
                <Focus className="w-10 h-10 text-emerald-400" strokeWidth={1.8} />
                <span className="text-emerald-300 text-xs tracking-wide">辨識完成 ✓ 下滑查看報告</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 頂部狀態列 */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-1.5 bg-black/30 backdrop-blur-sm rounded-full px-3 py-1.5">
          <ScanLine className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-white text-[11px] font-semibold tracking-wide">Supplement Lens</span>
        </div>
        <div className="flex items-center gap-1.5 bg-black/30 backdrop-blur-sm rounded-full px-3 py-1.5">
          <Sparkles className="w-3 h-3 text-amber-300" />
          <span className="text-white/80 text-[10px]">AI Vision</span>
        </div>
      </div>

      {/* ── 底部控制列:快門鍵(中)+ 圖庫鍵(右)── */}
      <div className="absolute bottom-0 inset-x-0 pb-5 pt-8 bg-gradient-to-t from-black/50 to-transparent">
        <div className="relative flex items-center justify-center">
          {/* 快門鍵:iOS 風格雙圈 */}
          <button
            onClick={onCapture}
            disabled={scanState === "scanning"}
            aria-label="拍照辨識"
            className="relative w-[68px] h-[68px] rounded-full border-4 border-white/90 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50"
          >
            <span
              className={`w-[52px] h-[52px] rounded-full transition-colors ${
                scanState === "scanning" ? "bg-emerald-400 animate-pulse" : "bg-white"
              }`}
            />
            <Camera className="absolute w-6 h-6 text-stone-700" strokeWidth={2.2} />
          </button>

          {/* 圖庫鍵 */}
          <button
            onClick={onGallery}
            disabled={scanState === "scanning"}
            aria-label="從圖庫選擇照片"
            className="absolute right-8 flex flex-col items-center gap-1 active:scale-90 transition-transform disabled:opacity-50"
          >
            <span className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-md border border-white/30 flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-white" strokeWidth={2} />
            </span>
            <span className="text-white/70 text-[9px] font-semibold tracking-wide">圖庫</span>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes scanline {
          0%, 100% { top: 8%; }
          50% { top: 88%; }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ★ v2.0 新卡片:致命踩雷警告 (Toxic / Anomaly Alert)
// ═══════════════════════════════════════════════════════════════════════
function CardToxicAlert({ data }) {
  // 無異常:綠色安全盾牌(低調小卡)
  if (!data.detected) {
    return (
      <Card className="border-emerald-100">
        <div className="flex items-center gap-3.5 px-5 py-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-emerald-500" strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-sm font-bold text-emerald-700">未偵測到黑名單/異常成分</p>
            <p className="text-[11px] text-stone-400 mt-0.5">已比對違規添加物與品類錯位資料庫,一切正常</p>
          </div>
        </div>
      </Card>
    );
  }

  // 偵測到異常:最高級別警告 — 深色底 + 螢光紅
  return (
    <div className="relative overflow-hidden rounded-2xl shadow-lg shadow-red-900/30">
      {/* 深色底 + 危險紅光暈 */}
      <div className="absolute inset-0 bg-gradient-to-br from-stone-900 via-[#1c0a0a] to-stone-900" />
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-red-600/20 blur-3xl" />
      <div className="absolute -bottom-20 -left-16 w-56 h-56 rounded-full bg-red-500/10 blur-3xl" />
      {/* 危險斜紋頂條 */}
      <div
        className="absolute top-0 inset-x-0 h-1.5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #ef4444 0 12px, #1c1917 12px 24px)",
        }}
      />

      <div className="relative p-5">
        {/* 標題 */}
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-xl bg-red-500/15 border border-red-500/40 flex items-center justify-center shrink-0">
            <Siren className="w-6 h-6 text-red-400" strokeWidth={2.2} />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
          </div>
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-red-400">TOXIC ALERT</p>
            <h3 className="text-base font-black text-red-300 leading-tight mt-0.5"
                style={{ textShadow: "0 0 16px rgba(248,113,113,0.6)" }}>
              致命踩雷警告
            </h3>
          </div>
        </div>

        {/* 異常成分清單 */}
        {data.items.map((item) => (
          <div key={item.name} className="mt-4 rounded-xl bg-red-950/60 border border-red-500/30 p-4">
            <div className="flex items-center gap-2">
              <Skull className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm font-black text-red-300 tracking-wide"
                 style={{ textShadow: "0 0 12px rgba(248,113,113,0.5)" }}>
                發現異常添加物:{item.name}
              </p>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[10px] font-bold tracking-widest text-red-400/80 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> 為什麼這個成分不該出現在這裡?
                </p>
                <p className="text-xs text-red-100/90 leading-relaxed mt-1.5">{item.reason}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-widest text-red-400/80 flex items-center gap-1.5">
                  <Droplets className="w-3 h-3" /> 長期食用的潛在危害
                </p>
                <p className="text-xs text-red-100/90 leading-relaxed mt-1.5">{item.harm}</p>
              </div>
            </div>
          </div>
        ))}

        {/* 底部行動建議 */}
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-500/15 border border-red-500/30 px-3.5 py-2.5">
          <Ban className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-[11px] font-bold text-red-300">建議:立即放回貨架,並可向食藥署 1919 檢舉專線通報</p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 卡片 A~E(沿用 v1 設計)
// ═══════════════════════════════════════════════════════════════════════

function CardBasicInfo({ data }) {
  return (
    <Card>
      <CardHeader icon={Globe} title="基本身家調查" subtitle="產品識別與認證確認" iconBg="bg-sky-50" iconColor="text-sky-600" />
      <div className="px-5 pb-5">
        <p className="text-lg font-bold text-stone-800 leading-snug">{data.name}</p>
        <p className="text-xs text-stone-400 mt-1">{data.brand}</p>
        <div className="flex items-center gap-2 mt-3 text-sm text-stone-600">
          <span className="text-base">{data.countryFlag}</span>
          <span>生產國家:{data.country}</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {data.certifications.map((cert) => (
            <div
              key={cert.label}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border ${
                cert.verified
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-stone-50 text-stone-400 border-stone-200 line-through decoration-red-400"
              }`}
            >
              {cert.verified ? <BadgeCheck className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
              {cert.label}
            </div>
          ))}
        </div>
        {data.certifications.some((c) => !c.verified) && (
          <p className="flex items-start gap-1.5 mt-3 text-[11px] text-stone-400 leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            {data.certifications.find((c) => !c.verified)?.note}
          </p>
        )}
      </div>
    </Card>
  );
}

function CardCoreCheck({ data }) {
  const v = VERDICT_CONFIG[data.verdict];
  const isFail = data.verdict === "fail";
  const isPass = data.verdict === "pass";

  return (
    <Card className={isFail ? "ring-2 ring-red-200 ring-offset-2 ring-offset-transparent" : ""}>
      <CardHeader
        icon={ShieldCheck}
        title="核心指標防雷查核"
        subtitle={`品類:${data.category}`}
        iconBg={isFail ? "bg-red-50" : "bg-emerald-50"}
        iconColor={isFail ? "text-red-500" : "text-emerald-600"}
      />
      <div className="px-5 pb-5 space-y-4">
        <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-amber-700 tracking-wide">此品類的黃金標準</span>
          </div>
          <p className="text-base font-bold text-stone-800 mt-1.5">{data.goldStandard}</p>
          <p className="text-xs text-stone-500 mt-1 leading-relaxed">{data.goldStandardDesc}</p>
        </div>

        {/* 紅綠雙欄對照(v1 保留)*/}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3.5 bg-emerald-50/60 border border-emerald-100">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-[10px] font-bold text-emerald-700 tracking-wide">臨床有效標準</span>
            </div>
            <p className="text-sm font-bold text-emerald-800 mt-1.5 leading-snug">{data.clinicalThreshold}</p>
          </div>
          <div className={`rounded-xl p-3.5 border ${isPass ? "bg-emerald-50/60 border-emerald-100" : "bg-red-50/70 border-red-100"}`}>
            <div className="flex items-center gap-1.5">
              {isPass ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
              <span className={`text-[10px] font-bold tracking-wide ${isPass ? "text-emerald-700" : "text-red-600"}`}>此產品實際標示</span>
            </div>
            <p className={`text-sm font-bold mt-1.5 leading-snug ${isPass ? "text-emerald-800" : "text-red-700"}`}>{data.actualLabel}</p>
          </div>
        </div>

        <p className="text-xs text-stone-500 leading-relaxed">{data.actualDetail}</p>

        {/* 信任度燈號 + animate-ping 呼吸紅點(v1 保留)*/}
        <div className={`relative overflow-hidden rounded-xl border-2 ${v.border} ${v.bg}`}>
          {isFail && <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 via-transparent to-red-500/5" />}
          <div className="relative flex items-start gap-3 p-4">
            <div className="relative shrink-0 mt-0.5">
              {isPass ? (
                <ShieldCheck className={`w-6 h-6 ${v.color}`} strokeWidth={2.2} />
              ) : (
                <AlertOctagon className={`w-6 h-6 ${v.color}`} strokeWidth={2.2} />
              )}
              {isFail && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${v.dot} ${isFail ? "animate-pulse" : ""}`} />
                <span className={`text-xs font-black tracking-widest ${v.color}`}>{v.label}</span>
              </div>
              <p className={`text-sm font-bold mt-1.5 leading-relaxed ${v.color}`}>{data.warningText}</p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const INGREDIENT_STYLES = {
  natural: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: Leaf, legend: "天然/安全" },
  additive: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: FlaskConical, legend: "化學添加/填充" },
  allergen: { bg: "bg-red-50", border: "border-red-200", text: "text-red-600", icon: Ban, legend: "常見過敏原" },
  // v2.0 新增:黑名單成分標籤 — 深色高對比
  toxic: { bg: "bg-stone-900", border: "border-red-500", text: "text-red-400", icon: Skull, legend: "黑名單成分" },
};

function CardIngredients({ ingredients }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <Card>
      <CardHeader icon={FlaskConical} title="成分照妖鏡" subtitle="點擊標籤查看白話說明" iconBg="bg-violet-50" iconColor="text-violet-600" />
      <div className="px-5 pb-5">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
          {Object.entries(INGREDIENT_STYLES).map(([key, s]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  key === "natural" ? "bg-emerald-400" : key === "additive" ? "bg-amber-400" : key === "allergen" ? "bg-red-400" : "bg-stone-900 ring-2 ring-red-400"
                }`}
              />
              <span className="text-[10px] text-stone-400">{s.legend}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {ingredients.map((ing, i) => {
            const s = INGREDIENT_STYLES[ing.type];
            const Icon = s.icon;
            const isOpen = expanded === i;
            const isToxic = ing.type === "toxic";
            return (
              <button
                key={ing.name}
                onClick={() => setExpanded(isOpen ? null : i)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all active:scale-95 ${s.bg} ${s.border} ${s.text} ${
                  isOpen ? "ring-2 ring-offset-1 ring-stone-200" : ""
                } ${isToxic ? "border-2 shadow-md shadow-red-500/30" : ""}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {ing.name}
                {isToxic && (
                  <span className="relative flex h-2 w-2 ml-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {expanded !== null && (
          <div
            className={`mt-4 rounded-xl p-3.5 text-xs leading-relaxed flex gap-2 border ${
              ingredients[expanded].type === "toxic"
                ? "bg-stone-900 border-red-500/50 text-red-200"
                : "bg-stone-50 border-stone-100 text-stone-600"
            }`}
          >
            <Info className={`w-4 h-4 shrink-0 mt-px ${ingredients[expanded].type === "toxic" ? "text-red-400" : "text-stone-400"}`} />
            <span>
              <strong className={ingredients[expanded].type === "toxic" ? "text-red-300" : "text-stone-700"}>
                {ingredients[expanded].name}:
              </strong>
              {ingredients[expanded].plainText}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

function CardDosage({ data }) {
  const pct = Math.min(100, Math.round((data.actualAmount / data.dailyNeed) * 100));
  const isLow = pct < 60;
  return (
    <Card>
      <CardHeader icon={Gauge} title="劑量與功效白話文" subtitle="這一罐,到底夠不夠?" iconBg="bg-orange-50" iconColor="text-orange-500" />
      <div className="px-5 pb-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] text-stone-400 font-semibold tracking-wide">每日所需 {data.nutrientName}</p>
            <p className="text-4xl font-black text-stone-800 mt-1 tabular-nums">
              {data.dailyNeed}
              <span className="text-base font-bold text-stone-400 ml-1">{data.unit}</span>
            </p>
          </div>
          <div className="text-right">
            <p className={`text-[11px] font-semibold tracking-wide ${isLow ? "text-red-400" : "text-emerald-500"}`}>此產品推估提供</p>
            <p className={`text-4xl font-black mt-1 tabular-nums ${isLow ? "text-red-500" : "text-emerald-600"}`}>
              ~{data.actualAmount}
              <span className={`text-base font-bold ml-1 ${isLow ? "text-red-300" : "text-emerald-300"}`}>{data.unit}</span>
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-3 w-full rounded-full bg-stone-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                isLow ? "bg-gradient-to-r from-red-400 to-red-500" : "bg-gradient-to-r from-emerald-400 to-emerald-500"
              }`}
              style={{ width: `${Math.max(pct, 4)}%` }}
            />
          </div>
          <p className={`text-[11px] font-bold mt-1.5 ${isLow ? "text-red-400" : "text-emerald-500"}`}>
            達每日建議量的 {pct}% {isLow ? "⚠️" : "✓"}
          </p>
        </div>

        <div className="mt-5 space-y-3">
          {data.plainTalk.map((item) => (
            <div key={item.q} className="rounded-xl bg-stone-50/80 border border-stone-100 p-3.5">
              <p className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 text-emerald-500" />
                {item.q}
              </p>
              <p className="text-xs text-stone-500 mt-1.5 leading-relaxed pl-5">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

const AUDIENCE_ICONS = { clock: Clock, heart: Heart, zap: Zap };

function CardAudience({ data }) {
  return (
    <Card>
      <CardHeader icon={Users} title="受眾群體分析" subtitle="這罐,是為你設計的嗎?" iconBg="bg-teal-50" iconColor="text-teal-600" />
      <div className="px-5 pb-5 space-y-4">
        <div>
          <p className="text-xs font-bold text-emerald-600 tracking-wide mb-2.5 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> 適合對象(此品類)
          </p>
          <div className="space-y-2">
            {data.suitable.map((s) => {
              const Icon = AUDIENCE_ICONS[s.icon] || Users;
              return (
                <div key={s.label} className="flex items-center gap-3 rounded-xl bg-emerald-50/50 border border-emerald-100 px-3.5 py-2.5">
                  <Icon className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-sm text-stone-700">{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl bg-red-50/70 border-2 border-red-100 p-4">
          <p className="text-xs font-black text-red-500 tracking-wide mb-3 flex items-center gap-1.5">
            <UserX className="w-4 h-4" /> ⚠️ 以下族群請特別注意
          </p>
          <div className="space-y-2.5">
            {data.unsuitable.map((u) => (
              <div key={u.label} className="flex gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-600 leading-tight">{u.label}</p>
                  <p className="text-[11px] text-red-400 mt-0.5 leading-relaxed">{u.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 完整報告(掃描結果 & 歷史回放共用)
// ═══════════════════════════════════════════════════════════════════════
function FullReport({ product }) {
  return (
    <div className="space-y-4">
      <CardBasicInfo data={product.basicInfo} />
      {/* 致命踩雷警告置於最上方視覺焦點之後、核心查核之前 */}
      <CardToxicAlert data={product.toxicAlert} />
      <CardCoreCheck data={product.coreCheck} />
      <CardIngredients ingredients={product.ingredients} />
      <CardDosage data={product.dosage} />
      <CardAudience data={product.audience} />
      <p className="text-center text-[10px] text-stone-300 leading-relaxed px-6 pt-2">
        本分析僅供參考,不構成醫療建議。
        <br />
        實際保健需求請諮詢醫師或營養師。
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 歷史紀錄分頁:點擊回放完整報告
// ═══════════════════════════════════════════════════════════════════════
function HistoryTab({ history }) {
  const [selected, setSelected] = useState(null); // 被點擊的歷史紀錄

  // ── 回放模式:全螢幕報告 + 返回鍵 ──
  if (selected) {
    return (
      <div className="pb-28">
        {/* 置頂返回列 */}
        <div className="sticky top-0 z-40 bg-[#f6f7f2]/85 backdrop-blur-xl border-b border-stone-100">
          <div className="flex items-center gap-2 px-3 py-3">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-0.5 text-emerald-600 font-semibold text-sm active:scale-95 transition-transform pr-2"
            >
              <ChevronLeft className="w-5 h-5" />
              歷史紀錄
            </button>
            <div className="min-w-0 flex-1 text-center pr-16">
              <p className="text-xs font-bold text-stone-700 truncate">{selected.product.basicInfo.name}</p>
              <p className="text-[10px] text-stone-400">掃描於 {selected.date}</p>
            </div>
          </div>
        </div>
        <div className="px-4 pt-4">
          <FullReport product={selected.product} />
        </div>
      </div>
    );
  }

  // ── 清單模式 ──
  return (
    <div className="px-4 pt-6 pb-28 space-y-3">
      <h2 className="text-xl font-black text-stone-800 px-1 mb-1">掃描歷史</h2>
      <p className="text-[11px] text-stone-400 px-1 mb-3">點擊任一筆紀錄,回放當時的完整透視報告</p>
      {history.map((item) => {
        const v = VERDICT_CONFIG[item.verdict];
        return (
          <button
            key={item.id}
            onClick={() => setSelected(item)}
            className="w-full text-left"
          >
            <Card className="p-4 flex items-center gap-3.5 active:scale-[0.98] transition-transform">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${item.hasToxic ? "bg-stone-900" : v.bg}`}>
                {item.hasToxic ? (
                  <Skull className="w-5 h-5 text-red-400" />
                ) : item.verdict === "pass" ? (
                  <CheckCircle2 className={`w-5 h-5 ${v.color}`} />
                ) : item.verdict === "caution" ? (
                  <AlertTriangle className={`w-5 h-5 ${v.color}`} />
                ) : (
                  <AlertOctagon className={`w-5 h-5 ${v.color}`} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-stone-800 truncate">{item.product.basicInfo.name}</p>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  {item.category} · {item.date}
                </p>
                {item.hasToxic && (
                  <p className="text-[10px] font-bold text-red-500 mt-1 flex items-center gap-1">
                    <Siren className="w-3 h-3" /> 含黑名單成分
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${v.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
                  <span className={`text-[10px] font-bold ${v.color}`}>{v.label}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </div>
            </Card>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 設定分頁
// ═══════════════════════════════════════════════════════════════════════
function SettingsTab() {
  const [toggles, setToggles] = useState({ allergen: true, strict: true, blacklist: true, notify: false });
  const settings = [
    { key: "blacklist", title: "黑名單成分即時警報", desc: "偵測到違規添加物時,以最高級別警告提醒" },
    { key: "allergen", title: "過敏原自動警示", desc: "掃描時自動比對我的過敏原清單" },
    { key: "strict", title: "嚴格臨床標準模式", desc: "以最高等級臨床研究標準判定信任燈號" },
    { key: "notify", title: "回購提醒通知", desc: "保健品快吃完時提醒我" },
  ];
  return (
    <div className="px-4 pt-6 pb-28 space-y-3">
      <h2 className="text-xl font-black text-stone-800 px-1 mb-4">設定</h2>
      {settings.map((s) => (
        <Card key={s.key} className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-stone-800">{s.title}</p>
            <p className="text-[11px] text-stone-400 mt-0.5 leading-relaxed">{s.desc}</p>
          </div>
          <button
            onClick={() => setToggles((t) => ({ ...t, [s.key]: !t[s.key] }))}
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${toggles[s.key] ? "bg-emerald-500" : "bg-stone-200"}`}
            aria-label={s.title}
          >
            <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-sm transition-all ${toggles[s.key] ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </Card>
      ))}
      <p className="text-center text-[10px] text-stone-300 pt-6">Supplement Lens v3.0.0 · Powered by Gemini 3.5 Flash</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 底部固定導覽列
// ═══════════════════════════════════════════════════════════════════════
function BottomNav({ tab, setTab }) {
  const items = [
    { key: "scan", label: "掃描", icon: ScanLine },
    { key: "history", label: "歷史紀錄", icon: History },
    { key: "settings", label: "設定", icon: Settings },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 flex justify-center pointer-events-none">
      <div className="w-full max-w-md pointer-events-auto">
        <div className="mx-4 mb-4 bg-white/90 backdrop-blur-xl border border-stone-100 rounded-2xl shadow-lg shadow-stone-200/50 flex">
          {items.map((item) => {
            const active = tab === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className="flex-1 flex flex-col items-center gap-1 py-3 active:scale-95 transition-transform"
              >
                <Icon className={`w-5 h-5 transition-colors ${active ? "text-emerald-600" : "text-stone-300"}`} strokeWidth={active ? 2.4 : 2} />
                <span className={`text-[10px] font-bold transition-colors ${active ? "text-emerald-600" : "text-stone-300"}`}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ★ v3.0:全螢幕 Loading 遮罩(等待 API 期間顯示,避免使用者以為當機)
// ═══════════════════════════════════════════════════════════════════════
const LOADING_STEPS = [
  "上傳照片並進行 OCR 文字辨識…",
  "AI 正在解析成分與比對資料庫…",
  "比對黃金標準與黑名單成分…",
  "產生白話文透視報告…",
];

function LoadingOverlay() {
  const [step, setStep] = useState(0);
  // 每 2.5 秒輪播一句進度文字,讓等待感受更短
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => (s + 1) % LOADING_STEPS.length), 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/60 backdrop-blur-sm">
      <div className="mx-8 w-full max-w-xs bg-white rounded-2xl shadow-xl p-6 flex flex-col items-center text-center">
        {/* 掃描動畫:對焦框 + 旋轉環 */}
        <div className="relative w-16 h-16">
          <Loader2 className="w-16 h-16 text-emerald-400 animate-spin" strokeWidth={1.2} />
          <ScanLine className="absolute inset-0 m-auto w-7 h-7 text-emerald-500" strokeWidth={2} />
        </div>
        <p className="text-sm font-black text-stone-800 mt-4">AI 正在解析成分與比對資料庫...</p>
        <p className="text-xs text-stone-400 mt-2 leading-relaxed min-h-[2.5em] transition-all">
          {LOADING_STEPS[Math.min(step, LOADING_STEPS.length - 1)]}
        </p>
        {/* 進度點 */}
        <div className="flex gap-1.5 mt-3">
          {LOADING_STEPS.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? "bg-emerald-500" : "bg-stone-200"}`}
            />
          ))}
        </div>
        <p className="text-[10px] text-stone-300 mt-4">Gemini 視覺分析通常需要 5~20 秒</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 主 App(v3.0:真實 API 資料流 + 狀態管理)
// ═══════════════════════════════════════════════════════════════════════
export default function SupplementLensApp() {
  const [tab, setTab] = useState("scan");
  const [scanState, setScanState] = useState("idle"); // idle | scanning | done
  const [showReport, setShowReport] = useState(true); // 預設展示 Demo 報告方便預覽
  const [previewUrl, setPreviewUrl] = useState(null); // 使用者選取照片的預覽

  // ★ v3.0 核心狀態:畫面由這份 product JSON 驅動——
  //   Demo 模式下是 Mock Data;真實模式下會被 API 回傳結果整份替換
  const [product, setProduct] = useState(PRODUCT_CRANBERRY);
  const [isDemo, setIsDemo] = useState(true); // 目前顯示的是否為示範資料
  const [apiError, setApiError] = useState(null); // API 錯誤訊息(顯示為紅色橫幅)
  const [history, setHistory] = useState(MOCK_HISTORY); // 動態歷史紀錄

  const reportRef = useRef(null);
  const captureInputRef = useRef(null); // 快門(手機喚起相機)
  const galleryInputRef = useRef(null); // 圖庫(開啟相簿)

  // 掃描完成後的共用收尾:顯示報告 + 平滑捲動
  const finishScan = () => {
    setScanState("done");
    setShowReport(true);
    setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  };

  // ═════════════════════════════════════════════════════════════════════
  // ★ v3.0 真實資料流:選圖 → Base64 → 呼叫 API → useState 更新畫面
  // ═════════════════════════════════════════════════════════════════════
  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允許重選同一張照片
    if (!file) return;

    // 1) 即時預覽:照片渲染為觀景窗背景
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));

    // 2) 進入 Loading 狀態(全螢幕遮罩由 scanState === "scanning" 觸發)
    setScanState("scanning");
    setShowReport(false);
    setApiError(null);

    // 3) 分析流程(v4.0):
    //    有 VITE Key → 前端直連 Gemini(本地開發)
    //    無 Key     → 呼叫後端 /api/analyze(正式部署)
    //    兩者都不可用 → 自動退回 Demo 模式播放 Mock Data
    try {
      const { base64, mimeType } = await fileToBase64(file); // 壓縮 + 轉 Base64 + MIME
      const result = await analyzeWithGemini({ base64, mimeType }); // 雙模式分析

      // 4) 用 API 回傳的 JSON 整份替換畫面資料
      setProduct(result);
      setIsDemo(false);

      // 5) 自動寫入歷史紀錄(置頂)
      setHistory((prev) => [
        {
          id: result.id,
          product: result,
          date: "剛剛",
          verdict: result.coreCheck.verdict,
          category: result.coreCheck.category,
          hasToxic: result.toxicAlert.detected,
        },
        ...prev,
      ]);

      finishScan();
    } catch (err) {
      // 沒有 Key 也沒有後端(如本地 npm run dev 未填 .env.local)→ Demo 模式
      if (err.code === "NO_ANALYZER") {
        setTimeout(() => {
          setProduct(PRODUCT_CRANBERRY);
          setIsDemo(true);
          finishScan();
        }, 1200);
        return;
      }
      // 其他錯誤:回到待機狀態並顯示紅色錯誤橫幅(保留上一份報告)
      console.error("[Supplement Lens] 分析失敗:", err);
      setApiError(err.message || "分析失敗,請重試");
      setScanState("idle");
      setShowReport(true);
    }
  };

  // 快門鍵:喚起相機(手機)或檔案選擇器(桌機);只在真的選了照片後才分析
  const handleCapture = () => {
    if (scanState === "scanning") return;
    captureInputRef.current?.click();
  };

  // 圖庫鍵:開啟相簿選圖
  const handleGallery = () => {
    if (scanState === "scanning") return;
    galleryInputRef.current?.click();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f7f2] via-[#f3f6ef] to-[#eef3ea] font-sans antialiased">
      <div className="max-w-md mx-auto min-h-screen relative">
        {tab === "scan" && (
          <>
            <CameraViewfinder
              scanState={scanState}
              previewUrl={previewUrl}
              onCapture={handleCapture}
              onGallery={handleGallery}
              captureInputRef={captureInputRef}
              galleryInputRef={galleryInputRef}
              onFileSelected={handleFileSelected}
            />

            <div className="relative -mt-5 rounded-t-3xl">
              <div className="px-4 pt-2 pb-28 space-y-4" ref={reportRef}>
                <div className="flex justify-center pt-1">
                  <div className="w-10 h-1 rounded-full bg-stone-300/70" />
                </div>

                {/* API 錯誤橫幅(Key 無效、額度用罄、照片模糊等) */}
                {apiError && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-red-600">分析失敗</p>
                      <p className="text-[11px] text-red-500 mt-0.5 leading-relaxed">{apiError}</p>
                    </div>
                  </div>
                )}

                {showReport ? (
                  <>
                    <div className="flex items-center justify-between px-1 pt-1">
                      <h2 className="text-lg font-black text-stone-800">透視報告</h2>
                      {/* Demo / 真實分析 狀態標籤 */}
                      {isDemo ? (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 rounded-full px-2.5 py-1 border border-amber-200">
                          示範資料 · 填入 API Key 啟用真實分析
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 rounded-full px-2.5 py-1 border border-emerald-200">
                          Gemini 分析完成 · 剛剛
                        </span>
                      )}
                    </div>
                    {/* ★ 畫面由 product 狀態驅動:API 回傳後整份替換 */}
                    <FullReport product={product} />
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                    <p className="text-xs text-stone-400">正在進行 OCR 辨識、成分比對與黑名單掃描…</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "history" && <HistoryTab history={history} />}
        {tab === "settings" && <SettingsTab />}

        {/* ★ 全螢幕 Loading 遮罩:等待 Gemini 回傳期間顯示,避免使用者以為當機 */}
        {scanState === "scanning" && <LoadingOverlay />}

        <BottomNav tab={tab} setTab={setTab} />
      </div>
    </div>
  );
}
