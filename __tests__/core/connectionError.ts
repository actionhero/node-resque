import { Connection } from "../../src";
import specHelper from "../utils/specHelper";

describe("connection error", () => {
  test("can provide an error if connection failed", async () => {
    await new Promise(async (resolve) => {
      const connectionDetails = {
        pkg: specHelper.connectionDetails.pkg,
        host: "wronghostname",
        password: specHelper.connectionDetails.password,
        port: specHelper.connectionDetails.port,
        database: specHelper.connectionDetails.database,
        namespace: specHelper.connectionDetails.namespace,
        options: { maxRetriesPerRequest: 1 },
      };

      const brokenConnection = new Connection(connectionDetails);

      brokenConnection.on("error", async (error) => {
        expect(error.message).toMatch(
          /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN/
        );
      });

      try {
        await brokenConnection.connect();
      } catch (error) {
        setTimeout(resolve, 3 * 1000);
      }
    });
  });
});
