const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { main } = require("../index");

describe("cloudfunction/chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("unknown action returns code -1", async () => {
    const res = await main({ action: "unknown", payload: {} }, {});
    expect(res.code).toBe(-1);
  });

  it("createConversation rejects invalid target user", async () => {
    const accessToken = "chat_create_token";
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
          where: jest.fn(({ userId }) => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                data: userId === currentUser.userId ? [currentUser] : []
              })
            }))
          }))
        };
      }

      if (name === "conversations") {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({ data: [] })
            }))
          })),
          add: jest.fn().mockResolvedValue({ _id: "conversation_1" })
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
        action: "createConversation",
        payload: {
          targetUserId: "user_missing",
          houseId: "house_1"
        },
        auth: { accessToken }
      }, {});

      expect(res.code).toBe(404);
      expect(res.message).toBe("目标用户不存在或已失效");
    } finally {
      db.collection.mockImplementation(originalImplementation);
    }
  });

  it("sendMessage rejects invalid receiver user", async () => {
    const accessToken = "chat_send_token";
    const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
    const currentUser = {
      _id: "user_doc_1",
      userId: "user_1",
      status: "active"
    };
    const conversation = {
      _id: "conv_doc_1",
      conversationId: "conv_1",
      participantIds: ["user_1", "user_missing"],
      unreadMap: {}
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
          where: jest.fn(({ userId }) => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                data: userId === currentUser.userId ? [currentUser] : []
              })
            }))
          }))
        };
      }

      if (name === "conversations") {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({ data: [conversation] })
            }))
          })),
          doc: jest.fn(() => ({
            update: jest.fn().mockResolvedValue({ stats: { updated: 1 } })
          }))
        };
      }

      if (name === "chat_messages" || name === "messages") {
        return {
          add: jest.fn().mockResolvedValue({ _id: "mock_id" }),
          where: jest.fn().mockReturnThis(),
          update: jest.fn().mockResolvedValue({ stats: { updated: 1 } })
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
        action: "sendMessage",
        payload: {
          conversationId: "conv_1",
          content: "你好",
          messageType: "text"
        },
        auth: { accessToken }
      }, {});

      expect(res.code).toBe(404);
      expect(res.message).toBe("接收方不存在或已失效");
    } finally {
      db.collection.mockImplementation(originalImplementation);
    }
  });
});
