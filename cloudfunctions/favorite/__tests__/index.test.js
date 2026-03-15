const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { main } = require("../index");

describe("cloudfunction/favorite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("unknown action returns code -1", async () => {
    const res = await main({ action: "unknown", payload: {} }, {});
    expect(res.code).toBe(-1);
  });

  it("getList returns consistent total after filtering inactive houses", async () => {
    const accessToken = "favorite_list_token";
    const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
    const currentUser = {
      _id: "user_doc_1",
      userId: "user_1",
      status: "active"
    };
    const favoriteDocs = [
      { _id: "fav_1", userId: currentUser.userId, houseId: "house_active", createTime: new Date("2026-01-02") },
      { _id: "fav_2", userId: currentUser.userId, houseId: "house_deleted", createTime: new Date("2026-01-01") }
    ];
    const houseDocs = {
      house_active: { _id: "house_active", status: "active", title: "正常房源" },
      house_deleted: { _id: "house_deleted", status: "deleted", title: "失效房源" }
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
                    userId: currentUser.userId,
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
              get: jest.fn().mockResolvedValue({ data: [currentUser] })
            }))
          }))
        };
      }

      if (name === "favorites") {
        return {
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              skip: jest.fn(() => ({
                limit: jest.fn(() => ({
                  get: jest.fn().mockResolvedValue({ data: favoriteDocs })
                }))
              }))
            })),
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({ data: [] })
            }))
          }))
        };
      }

      if (name === "houses") {
        return {
          doc: jest.fn((id) => ({
            get: jest.fn().mockResolvedValue({ data: houseDocs[id] || null })
          }))
        };
      }

      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ data: [] }),
        add: jest.fn().mockResolvedValue({ _id: "mock_id" }),
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ data: null }),
          remove: jest.fn().mockResolvedValue({ stats: { removed: 1 } })
        }))
      };
    });

    try {
      const res = await main({
        action: "getList",
        payload: { page: 1, pageSize: 10 },
        auth: { accessToken }
      }, {});

      expect(res.code).toBe(0);
      expect(res.data.total).toBe(1);
      expect(res.data.list).toHaveLength(1);
      expect(res.data.list[0].houseId).toBe("house_active");
    } finally {
      db.collection.mockImplementation(originalImplementation);
    }
  });

  it("toggle rejects inactive house", async () => {
    const accessToken = "favorite_toggle_token";
    const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
    const currentUser = {
      _id: "user_doc_1",
      userId: "user_1",
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
                    userId: currentUser.userId,
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
              get: jest.fn().mockResolvedValue({ data: [currentUser] })
            }))
          }))
        };
      }

      if (name === "favorites") {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({ data: [] })
            }))
          })),
          add: jest.fn().mockResolvedValue({ _id: "fav_1" })
        };
      }

      if (name === "houses") {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ data: { _id: "house_deleted", status: "deleted" } })
          }))
        };
      }

      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ data: [] }),
        add: jest.fn().mockResolvedValue({ _id: "mock_id" }),
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ data: null }),
          remove: jest.fn().mockResolvedValue({ stats: { removed: 1 } })
        }))
      };
    });

    try {
      const res = await main({
        action: "toggle",
        payload: { houseId: "house_deleted" },
        auth: { accessToken }
      }, {});

      expect(res.code).toBe(404);
      expect(res.message).toBe("房源不存在或已下架");
    } finally {
      db.collection.mockImplementation(originalImplementation);
    }
  });
});
