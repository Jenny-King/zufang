#!/usr/bin/env node

const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const automator = require("miniprogram-automator");

const DEFAULTS = {
  addCount: 50,
  cliPaths: [
    process.env.WECHAT_DEVTOOLS_CLI || "",
    path.join(process.env.LOCALAPPDATA || "", "wechat-devtools-bin", "cli.bat"),
    "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat"
  ].filter(Boolean),
  connectDelayMs: 12000,
  connectRetries: 12,
  connectRetryDelayMs: 5000,
  cliTimeoutMs: 180000,
  waitMs: {
    pageReady: 1500,
    submitDone: 3500,
    storageDone: 1000,
    cloudDone: 400
  }
};

const TYPE_TEMPLATES = [
  {
    type: "一室",
    priceBase: 1080,
    areaBase: 28,
    floorBase: 5,
    paymentMethod: "月付",
    minRentPeriod: 3
  },
  {
    type: "一室一厅",
    priceBase: 1480,
    areaBase: 43,
    floorBase: 8,
    paymentMethod: "月付",
    minRentPeriod: 6
  },
  {
    type: "两室一厅",
    priceBase: 2180,
    areaBase: 68,
    floorBase: 10,
    paymentMethod: "季付",
    minRentPeriod: 6
  },
  {
    type: "三室及以上",
    priceBase: 3180,
    areaBase: 104,
    floorBase: 14,
    paymentMethod: "半年付",
    minRentPeriod: 12
  }
];

const COMMUNITY_NAMES = [
  "书香苑",
  "锦绣城",
  "青年里",
  "悦江府",
  "理想城",
  "金域华庭",
  "城南公馆",
  "湖景名邸",
  "云栖里",
  "星河湾",
  "未来方舟",
  "中央花园",
  "橙郡",
  "柏悦府",
  "长租公社",
  "都会国际",
  "天悦府",
  "时代名城",
  "景和园",
  "朗诗公寓"
];

const LANDMARK_TAGS = [
  "近地铁",
  "近商圈",
  "近学校",
  "步行公交站",
  "拎包入住",
  "通勤方便",
  "采光好",
  "安静小区",
  "电梯房",
  "随时看房"
];

const DESCRIPTION_TAGS = [
  "家电齐全，基础生活设施完善",
  "户型方正，适合学生或上班族合租",
  "楼下生活配套成熟，日常采购方便",
  "房间通风好，采光稳定，居住舒适",
  "通勤成本低，适合作为长期租住选择",
  "社区管理规范，出入更安心"
];

const ORIENTATIONS = ["南", "东南", "东", "西南", "北", "南北"];
const FACILITY_PRESETS = [
  ["wifi", "airConditioner", "washingMachine", "waterHeater", "bed", "wardrobe"],
  ["wifi", "airConditioner", "washingMachine", "refrigerator", "waterHeater", "balcony"],
  ["elevator", "wifi", "airConditioner", "washingMachine", "refrigerator", "security"],
  ["elevator", "parking", "wifi", "airConditioner", "washingMachine", "balcony", "security"],
  ["wifi", "bed", "waterHeater"],
  ["elevator", "wifi", "airConditioner", "washingMachine", "refrigerator", "gym"]
];

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function readOption(args, key, envKey, fallback) {
  if (args[key] !== undefined) {
    return args[key];
  }
  if (process.env[envKey] !== undefined) {
    return process.env[envKey];
  }
  return fallback;
}

function resolveCliPath(cliPathArg) {
  const candidatePaths = [cliPathArg || "", ...DEFAULTS.cliPaths].filter(Boolean);
  const matched = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!matched) {
    throw new Error("未找到微信开发者工具 CLI，请通过 --cli 或 WECHAT_DEVTOOLS_CLI 指定 cli.bat 路径");
  }
  return matched;
}

function escapeForPowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPowerShell(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutId = null;

    function finish(error) {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) {
        finish(null);
        return;
      }
      finish(new Error(`PowerShell command exited with code ${code}`));
    });

    timeoutId = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore kill failures on timeout cleanup.
      }
      finish(new Error(`PowerShell command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

async function runCli(cliPath, cliArgs, timeoutMs) {
  const command = `& '${escapeForPowerShell(cliPath)}' ${cliArgs
    .map((arg) => `'${escapeForPowerShell(arg)}'`)
    .join(" ")}`;
  return runPowerShell(command, timeoutMs);
}

async function findFreePort(preferredPort) {
  if (preferredPort) {
    return Number(preferredPort);
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function connectMiniProgram(wsEndpoint, connectRetries, retryDelayMs, attempt = 1, lastError = null) {
  try {
    const miniProgram = await automator.connect({ wsEndpoint });
    await miniProgram.systemInfo();
    return miniProgram;
  } catch (error) {
    if (attempt >= connectRetries) {
      throw error || lastError || new Error(`连接自动化 websocket 失败: ${wsEndpoint}`);
    }
    await sleep(retryDelayMs);
    return connectMiniProgram(wsEndpoint, connectRetries, retryDelayMs, attempt + 1, error);
  }
}

async function startMiniProgram(options) {
  const {
    cliPath,
    projectPath,
    port,
    connectDelayMs,
    connectRetries,
    connectRetryDelayMs,
    cliTimeoutMs
  } = options;

  console.log(`[reshape-house-data] 启动 DevTools auto, port=${port}`);
  const cliResult = await runCli(cliPath, [
    "auto",
    "--project",
    projectPath,
    "--auto-port",
    String(port),
    "--trust-project"
  ], cliTimeoutMs);

  if (cliResult.stderr.trim()) {
    console.log(cliResult.stderr.trim());
  }

  await sleep(connectDelayMs);
  return connectMiniProgram(`ws://127.0.0.1:${port}`, connectRetries, connectRetryDelayMs);
}

async function clearStorage(miniProgram) {
  await miniProgram.callWxMethod("clearStorageSync");
  await sleep(DEFAULTS.waitMs.storageDone);
}

async function getSession(miniProgram) {
  const accessToken = await miniProgram.callWxMethod("getStorageSync", "accessToken");
  const userInfo = await miniProgram.callWxMethod("getStorageSync", "userInfo");

  return {
    accessToken: typeof accessToken === "string" ? accessToken : "",
    userInfo: userInfo && typeof userInfo === "object" ? userInfo : null
  };
}

async function callCloud(miniProgram, functionName, action, payload = {}, auth = undefined) {
  return miniProgram.evaluate((name, event) => new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: event
    }).then((res) => resolve(res.result || res)).catch((err) => reject({
      message: err && err.message ? err.message : "cloud call failed",
      stack: err && err.stack ? err.stack : ""
    }));
  }), functionName, {
    action,
    payload,
    auth
  });
}

async function tryLogin(miniProgram, phone, password) {
  const page = await miniProgram.reLaunch("/package-auth/pages/login/index");
  await sleep(DEFAULTS.waitMs.pageReady);
  await page.setData({
    mode: "password",
    phone,
    password,
    code: "",
    submitLoading: false,
    sendingCode: false
  });
  await page.callMethod("onSubmitTap");
  await sleep(DEFAULTS.waitMs.submitDone);
  return getSession(miniProgram);
}

function assertCloudSuccess(result, message) {
  if (!result || result.code !== 0) {
    throw new Error(`${message}: ${result && result.message ? result.message : "请求失败"}`);
  }
}

function toTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function pickRegion(regions, index) {
  const normalizedRegions = Array.isArray(regions)
    ? regions.filter((item) => item && item.name && item.name !== "全市")
    : [];

  if (!normalizedRegions.length) {
    return `核心城区${(index % 4) + 1}`;
  }
  return normalizedRegions[index % normalizedRegions.length].name || `核心城区${(index % 4) + 1}`;
}

function buildFacilities(index) {
  const enabledKeys = FACILITY_PRESETS[index % FACILITY_PRESETS.length];
  return enabledKeys.reduce((accumulator, key) => {
    accumulator[key] = true;
    return accumulator;
  }, {});
}

function getImagePool(houses = []) {
  const pool = [];
  houses.forEach((house) => {
    (house.images || []).forEach((image) => {
      if (image && !pool.includes(image)) {
        pool.push(image);
      }
    });
  });
  return pool;
}

function pickImages(imagePool, index) {
  if (!imagePool.length) {
    return [];
  }

  const maxCount = Math.min(3, imagePool.length);
  return Array.from({ length: maxCount }).map((_, imageIndex) => (
    imagePool[(index + imageIndex) % imagePool.length]
  ));
}

function buildTitle(region, community, tag, type) {
  return `${region}${community}${tag}${type}`;
}

function buildDescription(region, community, tag, type, index) {
  const detail = DESCRIPTION_TAGS[index % DESCRIPTION_TAGS.length];
  return `${region}${community}，${tag}，${type}布局清晰，${detail}。支持线上咨询与预约看房。`;
}

function buildHouseProfile(options) {
  const {
    index,
    regions,
    phone,
    nickName,
    imagePool
  } = options;

  const template = TYPE_TEMPLATES[index % TYPE_TEMPLATES.length];
  const region = pickRegion(regions, index);
  const community = COMMUNITY_NAMES[index % COMMUNITY_NAMES.length];
  const tag = LANDMARK_TAGS[index % LANDMARK_TAGS.length];
  const orientation = ORIENTATIONS[index % ORIENTATIONS.length];
  const buildingNo = 1 + (index % 18);
  const roomNo = 201 + (index % 17) * 2;
  const regionPremium = (index % Math.max(1, regions.length || 4)) * 120;
  const typePremium = TYPE_TEMPLATES.findIndex((item) => item.type === template.type) * 180;
  const price = template.priceBase + regionPremium + typePremium + (index % 5) * 60;
  const area = template.areaBase + (index % 4) * 2;
  const totalFloors = template.floorBase + 10 + (index % 9);
  const currentFloor = Math.max(2, Math.min(totalFloors - 1, template.floorBase + (index % 6)));
  const contactName = nickName || `房东${String(phone || "").slice(-4)}`;

  return {
    title: buildTitle(region, community, tag, template.type),
    price,
    paymentMethod: template.paymentMethod,
    minRentPeriod: template.minRentPeriod,
    area,
    type: template.type,
    floor: `${currentFloor}/${totalFloors}`,
    orientation,
    address: `${region}${community}${buildingNo}栋${roomNo}室`,
    description: buildDescription(region, community, tag, template.type, index),
    images: pickImages(imagePool, index),
    latitude: 0,
    longitude: 0,
    contactName,
    contactPhone: String(phone || "").trim(),
    facilities: buildFacilities(index),
    region
  };
}

async function ensureLandlord(miniProgram, auth) {
  const currentUser = await callCloud(miniProgram, "user", "getCurrentUser", {}, auth);
  assertCloudSuccess(currentUser, "获取当前用户失败");

  const role = currentUser.data && currentUser.data.role ? currentUser.data.role : "";
  if (role === "landlord" || role === "admin") {
    return currentUser.data;
  }

  const switched = await callCloud(miniProgram, "user", "switchRole", { role: "landlord" }, auth);
  assertCloudSuccess(switched, "切换房东角色失败");
  console.log("[reshape-house-data] 当前账号原角色不是房东，已自动切换为 landlord");
  return switched.data;
}

async function getAllMyHouses(miniProgram, auth) {
  const pageSize = 20;
  let page = 1;
  let total = 0;
  const list = [];

  do {
    const result = await callCloud(miniProgram, "house", "getMine", {
      page,
      pageSize
    }, auth);
    assertCloudSuccess(result, `查询第 ${page} 页房源失败`);

    const currentList = Array.isArray(result.data && result.data.list) ? result.data.list : [];
    total = Number(result.data && result.data.total ? result.data.total : currentList.length);
    list.push(...currentList);
    page += 1;
  } while (list.length < total);

  return {
    total,
    list
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const phone = String(readOption(args, "phone", "SEED_PHONE", "") || "").trim();
  const password = String(readOption(args, "password", "SEED_PASSWORD", "") || "").trim();
  const cliPath = resolveCliPath(readOption(args, "cli", "WECHAT_DEVTOOLS_CLI", ""));
  const projectPath = path.resolve(readOption(args, "project", "WECHAT_PROJECT_PATH", process.cwd()));
  const port = await findFreePort(readOption(args, "port", "WECHAT_AUTO_PORT", ""));
  const addCount = Math.max(0, Number(readOption(args, "add-count", "SEED_ADD_HOUSE_COUNT", DEFAULTS.addCount)) || 0);

  if (!phone || !password) {
    throw new Error("请通过 --phone 和 --password 提供账号信息");
  }

  let miniProgram = null;
  try {
    console.log(`[reshape-house-data] project=${projectPath}`);
    console.log(`[reshape-house-data] phone=${phone}`);
    console.log(`[reshape-house-data] addCount=${addCount}`);

    miniProgram = await startMiniProgram({
      cliPath,
      projectPath,
      port,
      connectDelayMs: DEFAULTS.connectDelayMs,
      connectRetries: DEFAULTS.connectRetries,
      connectRetryDelayMs: DEFAULTS.connectRetryDelayMs,
      cliTimeoutMs: DEFAULTS.cliTimeoutMs
    });

    await clearStorage(miniProgram);
    const session = await tryLogin(miniProgram, phone, password);
    if (!session.accessToken) {
      throw new Error("账号登录失败，请先确认手机号和密码正确，且该账号已注册");
    }

    const auth = { accessToken: session.accessToken };
    const userInfo = await ensureLandlord(miniProgram, auth);
    const regionsResult = await callCloud(miniProgram, "house", "getRegions", {});
    assertCloudSuccess(regionsResult, "获取区域列表失败");
    const regions = Array.isArray(regionsResult.data) ? regionsResult.data : [];

    const mineBefore = await getAllMyHouses(miniProgram, auth);
    const existingHouses = Array.isArray(mineBefore.list)
      ? mineBefore.list.slice().sort((left, right) => toTimestamp(left.createTime) - toTimestamp(right.createTime))
      : [];
    const imagePool = getImagePool(existingHouses);

    if (!existingHouses.length) {
      throw new Error("当前账号下没有可调整的房源，请先准备基础房源数据");
    }

    const updatedSummaries = [];
    for (let index = 0; index < existingHouses.length; index += 1) {
      const house = existingHouses[index];
      const payload = buildHouseProfile({
        index,
        regions,
        phone,
        nickName: userInfo.nickName || "",
        imagePool
      });
      payload.images = Array.isArray(house.images) && house.images.length
        ? house.images
        : pickImages(imagePool, index);

      const updateResult = await callCloud(miniProgram, "house", "update", {
        houseId: house._id,
        ...payload
      }, auth);
      assertCloudSuccess(updateResult, `更新第 ${index + 1} 条房源失败`);
      updatedSummaries.push({
        houseId: house._id,
        title: payload.title,
        price: payload.price,
        region: payload.region
      });
      console.log(`[reshape-house-data] 已更新 ${index + 1}/${existingHouses.length}: ${payload.title}`);
      await sleep(DEFAULTS.waitMs.cloudDone);
    }

    const createdSummaries = [];
    for (let index = 0; index < addCount; index += 1) {
      const payload = buildHouseProfile({
        index: existingHouses.length + index,
        regions,
        phone,
        nickName: userInfo.nickName || "",
        imagePool
      });

      const createResult = await callCloud(miniProgram, "house", "create", payload, auth);
      assertCloudSuccess(createResult, `新增第 ${index + 1} 条房源失败`);
      createdSummaries.push({
        houseId: createResult.data && createResult.data._id ? createResult.data._id : "",
        title: payload.title,
        price: payload.price,
        region: payload.region
      });
      console.log(`[reshape-house-data] 已新增 ${index + 1}/${addCount}: ${payload.title}`);
      await sleep(DEFAULTS.waitMs.cloudDone);
    }

    const mineAfter = await getAllMyHouses(miniProgram, auth);

    console.log("[reshape-house-data] 处理完成");
    console.log(JSON.stringify({
      updatedCount: updatedSummaries.length,
      createdCount: createdSummaries.length,
      currentTotal: Number(mineAfter.total || 0),
      sampleUpdated: updatedSummaries.slice(0, 5),
      sampleCreated: createdSummaries.slice(0, 5)
    }, null, 2));
  } finally {
    if (miniProgram) {
      try {
        if (typeof miniProgram.close === "function") {
          await miniProgram.close();
        } else {
          miniProgram.disconnect();
        }
      } catch {
        // Ignore close failures during cleanup.
      }
    }
  }
}

main().catch((error) => {
  console.error("[reshape-house-data] 执行失败");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
