import { describe, it } from "node:test";
import assert from "node:assert";

describe("Chat Utils Module", () => {
  describe("getChatStats", () => {
    it("should return correct statistics for an empty array", async () => {
      const { getChatStats } = await import("../js/chat-utils.js");

      const stats = getChatStats([]);

      assert.deepStrictEqual(stats, {
        totalMessages: 0,
        userMessages: 0,
        botMessages: 0,
        totalCharacters: 0,
        averageMessageLength: 0,
      });
    });

    it("should return correct statistics for a typical array of messages", async () => {
      const { getChatStats } = await import("../js/chat-utils.js");

      const messages = [
        { sender: "user", text: "Hello" },
        { sender: "bot", text: "Hi there!" },
        { sender: "user", text: "How are you?" },
      ];

      const stats = getChatStats(messages);

      assert.deepStrictEqual(stats, {
        totalMessages: 3,
        userMessages: 2,
        botMessages: 1,
        totalCharacters: 26,
        averageMessageLength: 9,
      });
    });
  });
});
