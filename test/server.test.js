const assert = require("assert");
const { test } = require("node:test");
const { buildStats } = require("../server");

test("buildStats summarizes issue volume, completion rate, and high frequency categories", () => {
  const stats = buildStats({
    issues: [
      { status: "done", category: "设施维修" },
      { status: "assigned", category: "设施维修" },
      { status: "pending", category: "环境卫生" }
    ],
    activities: [
      { title: "议事会", participants: ["u1"], capacity: 10 }
    ]
  });

  assert.equal(stats.totalIssues, 3);
  assert.equal(stats.doneRate, 33);
  assert.deepEqual(stats.byStatus, { done: 1, assigned: 1, pending: 1 });
  assert.deepEqual(stats.highFrequency[0], { category: "设施维修", count: 2 });
  assert.deepEqual(stats.activities[0], { title: "议事会", registered: 1, capacity: 10 });
});
