import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAuthorizedCron } from "@/app/api/cron/reintentar-pendientes/route";

describe("cron reintentar-pendientes auth", () => {
  it("rechaza sin CRON_SECRET configurado", () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const req = new Request("http://localhost/api/cron/reintentar-pendientes", {
        headers: { "x-cron-secret": "x" },
      });
      assert.equal(isAuthorizedCron(req), false);
    } finally {
      if (prev !== undefined) process.env.CRON_SECRET = prev;
      else delete process.env.CRON_SECRET;
    }
  });

  it("acepta x-cron-secret", () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    try {
      const req = new Request("http://localhost/api/cron/reintentar-pendientes", {
        headers: { "x-cron-secret": "test-cron-secret" },
      });
      assert.equal(isAuthorizedCron(req), true);
    } finally {
      if (prev !== undefined) process.env.CRON_SECRET = prev;
      else delete process.env.CRON_SECRET;
    }
  });

  it("acepta Authorization Bearer (Vercel Cron)", () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    try {
      const req = new Request("http://localhost/api/cron/reintentar-pendientes", {
        headers: { Authorization: "Bearer test-cron-secret" },
      });
      assert.equal(isAuthorizedCron(req), true);
    } finally {
      if (prev !== undefined) process.env.CRON_SECRET = prev;
      else delete process.env.CRON_SECRET;
    }
  });

  it("rechaza secreto incorrecto", () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    try {
      const req = new Request("http://localhost/api/cron/reintentar-pendientes", {
        headers: { "x-cron-secret": "wrong" },
      });
      assert.equal(isAuthorizedCron(req), false);
    } finally {
      if (prev !== undefined) process.env.CRON_SECRET = prev;
      else delete process.env.CRON_SECRET;
    }
  });
});
