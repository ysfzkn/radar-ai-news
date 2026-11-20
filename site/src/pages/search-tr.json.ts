import type { APIRoute } from "astro";
import { loadData } from "../lib/data";
import { searchIndex } from "../lib/search-index";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(searchIndex(loadData().stories, "tr")), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
