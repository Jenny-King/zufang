const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { main } = require("../index");

describe("cloudfunction/house", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("unknown action returns code -1", async () => {
    const res = await main({ action: "unknown", payload: {} }, {});
    expect(res.code).toBe(-1);
  });

  it("getRegions returns code 0 with region list", async () => {
    const res = await main({ action: "getRegions", payload: {} }, {});
    expect(res.code).toBe(0);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("create rejects invalid house payload before writing", async () => {
    const accessToken = "house_create_token";
    const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
    const addMock = jest.fn().mockResolvedValue({ _id: "house_1" });
    const userDoc = {
      _id: "user_doc_1",
      userId: "user_1",
      role: "landlord",
      status: "active"
    };
    const db = cloud.database();
    const originalImplementation = db.collection.getMockImplementation();

    db.collection.mockImplementation((name) => {
      if (name === "user_sessions") {
        return {
          doc: jest.fn((id) => ({
            get: jest.fn().mockResolvedValue(id === tokenHash
              ? {
                  data: {
                    _id: tokenHash,
                    userId: userDoc.userId,
                    status: "active",
                    expireAt: new Date(Date.now() + 60 * 1000).toISOString()
                  }
                }
              : { data: null })
          }))
        };
      }

      if (name === "users") {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({ data: [userDoc] })
            }))
          }))
        };
      }

      if (name === "houses") {
        return {
          add: addMock,
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ data: null }),
            update: jest.fn().mockResolvedValue({ stats: { updated: 1 } })
          }))
        };
      }

      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ data: [] }),
        count: jest.fn().mockResolvedValue({ total: 0 }),
        add: jest.fn().mockResolvedValue({ _id: "mock_id" }),
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ data: null }),
          update: jest.fn().mockResolvedValue({ stats: { updated: 1 } })
        }))
      };
    });

    try {
      const res = await main({
        action: "create",
        payload: {
          title: "测试房源",
          price: 3000,
          address: "深圳南山",
          type: "一室一厅",
          paymentMethod: "",
          area: 0,
          images: [],
          contactPhone: "123"
        },
        auth: { accessToken }
      }, {});

      expect(res.code).toBe(400);
      expect(addMock).not.toHaveBeenCalled();
    } finally {
      db.collection.mockImplementation(originalImplementation);
    }
  });

  it("update rejects invalid title before writing", async () => {
    const accessToken = "house_update_token";
    const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
    const updateMock = jest.fn().mockResolvedValue({ stats: { updated: 1 } });
    const userDoc = {
      _id: "user_doc_1",
      userId: "user_1",
      role: "landlord",
      status: "active"
    };
    const houseDoc = {
      _id: "house_1",
      landlordUserId: userDoc.userId,
      status: "active"
    };
    const db = cloud.database();
    const originalImplementation = db.collection.getMockImplementation();

    db.collection.mockImplementation((name) => {
      if (name === "user_sessions") {
        return {
          doc: jest.fn((id) => ({
            get: jest.fn().mockResolvedValue(id === tokenHash
              ? {
                  data: {
                    _id: tokenHash,
                    userId: userDoc.userId,
                    status: "active",
                    expireAt: new Date(Date.now() + 60 * 1000).toISOString()
                  }
                }
              : { data: null })
          }))
        };
      }

      if (name === "users") {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({ data: [userDoc] })
            }))
          }))
        };
      }

      if (name === "houses") {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ data: houseDoc }),
            update: updateMock
          }))
        };
      }

      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ data: [] }),
        count: jest.fn().mockResolvedValue({ total: 0 }),
        add: jest.fn().mockResolvedValue({ _id: "mock_id" }),
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ data: null }),
          update: jest.fn().mockResolvedValue({ stats: { updated: 1 } })
        }))
      };
    });

    try {
      const res = await main({
        action: "update",
        payload: {
          houseId: "house_1",
          title: ""
        },
        auth: { accessToken }
      }, {});

      expect(res.code).toBe(400);
      expect(updateMock).not.toHaveBeenCalled();
    } finally {
      db.collection.mockImplementation(originalImplementation);
    }
  });
});
