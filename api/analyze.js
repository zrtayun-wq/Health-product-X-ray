// ============================================================================
// /api/analyze — Vercel Serverless Function(Node.js)
// ============================================================================
// 這是 Supplement Lens 的後端分析端點。API Key 只存在 Vercel 的環境變數中,
// 前端 bundle 裡完全不會出現 Key,任何人打開 DevTools 都偷不到。
//
// 【Vercel 環境變數設定】
//   在 Vercel 專案 → Settings → Environment Variables 新增:
//     Name:  GEMINI_API_KEY      (注意:沒有 VITE_ 前綴!)
//     Value: 你的 Google API Key
//
// 【本地開發】不需要動這個檔案 — 本地 npm run dev 時,前端偵測到
//   .env.local 的 VITE_GEMINI_API_KEY 會直連 Gemini(見 App.jsx)。
// ============================================================================

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

// ─── JSON 清洗與截斷修復(與前端 v3.1 相同的三段式防禦)──────────────────
function cleanJsonText(raw) {
  let text = (raw || "").trim();
  text = text.replace(/^```(?:json|JSON)?\s*/m, "").replace(/```\s*$/m, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) text = text.slice(first, last + 1);
  else if (first !== -1) text = text.slice(first);
  return text.trim();
}

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
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i] === "{" ? "}" : "]";
  return repaired;
}

// ─── 黑名單雙重防護(現在跑在後端,使用者無法繞過或竄改)──────────────────
const BLACKLIST_KEYWORDS = ["番瀉", "sennoside", "西布曲明", "sibutramine", "酚酞", "phenolphthalein", "西地那非", "sildenafil", "他達拉非", "tadalafil"];

function applyBlacklistDoubleCheck(result) {
  result.ingredients.forEach((ing) => {
    const hit = BLACKLIST_KEYWORDS.some((kw) => (ing.name || "").toLowerCase().includes(kw));
    if (hit && !result.toxicAlert.items.some((t) => t.name.includes(ing.name))) {
      ing.type = "toxic";
      result.toxicAlert.detected = true;
      result.toxicAlert.items.push({
        name: ing.name,
        severity: "critical",
        reason: "此成分命中系統黑名單資料庫(伺服器端比對),不應出現在保健食品中。",
        harm: "屬於違規/高風險添加物,長期食用有健康疑慮,強烈建議避免並向食藥署通報。",
      });
    }
  });
  return result;
}

// ─── Serverless Function 主體 ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: "伺服器尚未設定 GEMINI_API_KEY,請到 Vercel → Settings → Environment Variables 新增",
    });
  }

  const { base64, mimeType } = req.body || {};
  if (!base64 || !mimeType) {
    return res.status(400).json({ error: "缺少圖片資料 (base64 / mimeType)" });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
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
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingLevel: "low" },
            response_mime_type: "application/json",
            response_schema: GEMINI_RESPONSE_SCHEMA,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      const msg = errBody?.error?.message || "";
      if (response.status === 429) {
        return res.status(429).json({ error: "已達 Gemini 免費額度上限或請求過於頻繁,請稍後再試" });
      }
      return res.status(502).json({ error: `AI 服務暫時無法回應 (${response.status})${msg ? `:${msg}` : ""}` });
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === "SAFETY") {
      return res.status(422).json({ error: "照片內容被安全過濾器攔截,請改拍成分標示區域" });
    }

    const rawText = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
    if (!rawText) return res.status(502).json({ error: "AI 未回傳分析內容,請重試" });

    const cleaned = cleanJsonText(rawText);
    let result;
    try {
      result = JSON.parse(cleaned);
    } catch {
      try {
        result = JSON.parse(repairTruncatedJson(cleaned));
      } catch (e2) {
        console.error("[api/analyze] JSON 解析失敗,原始回傳:", rawText.slice(0, 2000));
        return res.status(502).json({ error: "分析不完整,請重新拍攝(伺服器已記錄詳細資訊)" });
      }
    }

    if (result.imageUnclear) {
      return res.status(422).json({ error: "照片模糊或未拍到成分標示,請對準包裝背面的成分表重新拍攝" });
    }

    result.toxicAlert = result.toxicAlert || { detected: false, items: [] };
    result.ingredients = Array.isArray(result.ingredients) ? result.ingredients : [];
    applyBlacklistDoubleCheck(result);

    result.id = `scan-${Date.now()}`;
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/analyze] 未預期錯誤:", err);
    return res.status(500).json({ error: "伺服器內部錯誤,請稍後再試" });
  }
}
