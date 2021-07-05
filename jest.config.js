module.exports = {
  maxWorkers: "50%",
  testPathIgnorePatterns: ["<rootDir>/__tests__/utils"],
  transform: {
    "^.+\\.ts?$": "ts-jest",
  },
};
