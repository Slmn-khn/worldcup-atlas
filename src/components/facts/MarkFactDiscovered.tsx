"use client";

// Records a visit to a fact's detail page in the local discovery-progress
// store (category + tags are kept alongside the slug so badge progress can
// be computed without a server round trip — see discoveryBadges.ts). No
// account required, never blocks rendering — it's a fire-and-forget effect
// with no visible output.

import { useEffect } from "react";
import { recordFactDiscovered } from "@/lib/discoveryProgress";
import type { FactCategory } from "@/generated/prisma/enums";

export default function MarkFactDiscovered({
  slug,
  category,
  tags,
}: {
  slug: string;
  category: FactCategory;
  tags: string[];
}) {
  useEffect(() => {
    recordFactDiscovered({ slug, category, tags });
    // A given slug always carries the same category/tags for the lifetime of
    // this page, so slug alone is the real identity here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return null;
}
