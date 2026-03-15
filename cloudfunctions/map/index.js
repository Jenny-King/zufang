const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function createLogger(context) {
  const prefix = `[map][${context?.requestId || "local"}]`;
  return {
    info(tag, data) {
      console.log(`${prefix}[INFO][${tag}]`, JSON.stringify(data || {}));
    },
    error(tag, data) {
      console.error(`${prefix}[ERROR][${tag}]`, JSON.stringify(data || {}));
    }
  };
}

function success(data, message = "") {
  return {
    code: 0,
    data: data === undefined ? null : data,
    message: String(message || "")
  };
}

function fail(message, code = -1, data = null) {
  return {
    code,
    data: data === undefined ? null : data,
    message: message || "请求失败"
  };
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw || "{}"));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

async function handleGeocode(payload) {
  const address = String(payload.address || "").trim();
  if (!address) return fail("address 不能为空");
  const key = process.env.TENCENT_MAP_KEY || "";
  const fallbackLocation = { lat: 0, lng: 0 };
  if (!key) {
    return success({
      latitude: 0,
      longitude: 0,
      formattedAddress: address,
      location: fallbackLocation,
      message: "未配置地图 key，返回占位坐标"
    });
  }
  const url = `https://apis.map.qq.com/ws/geocoder/v1/?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`;
  const data = await requestJson(url);
  if (Number(data.status) !== 0) return fail(data.message || "地址解析失败");
  const location = data.result?.location || fallbackLocation;
  const latitude = Number(location.lat || 0);
  const longitude = Number(location.lng || 0);
  const formattedAddress = String(
    data.result?.formatted_addresses?.recommend
      || data.result?.address
      || address
  ).trim() || address;
  return success({
    latitude,
    longitude,
    formattedAddress,
    location: {
      lat: latitude,
      lng: longitude
    }
  });
}

async function handleSearchNearby(payload) {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const keywords = String(payload.keywords || "").trim() || "超市|地铁|公交";
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return fail("经纬度格式错误");
  const key = process.env.TENCENT_MAP_KEY || "";
  if (!key) {
    return success([]);
  }
  const boundary = `nearby(${latitude},${longitude},1000)`;
  const url = `https://apis.map.qq.com/ws/place/v1/search?keyword=${encodeURIComponent(keywords)}&boundary=${encodeURIComponent(boundary)}&key=${encodeURIComponent(key)}`;
  const data = await requestJson(url);
  if (Number(data.status) !== 0) return fail(data.message || "周边检索失败");
  const list = (data.data || []).slice(0, 5).map((item) => ({
    title: item.title,
    distance: Number(item._distance || item.distance || 0),
    category: item.category || item.type || ""
  }));
  return success(list);
}

exports.main = async (event, context) => {
  const logger = createLogger(context);
  const action = event?.action || "";
  const payload = event?.payload || {};
  logger.info("start", { action });
  try {
    let result = fail("未知 action");
    if (action === "geocode") result = await handleGeocode(payload);
    if (action === "searchNearby") result = await handleSearchNearby(payload);
    logger.info("success", { action, code: result.code });
    return result;
  } catch (err) {
    logger.error("fail", { action, err: err.message, stack: err.stack });
    return fail(err.message || "服务异常", 500);
  }
};
