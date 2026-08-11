import { requirePermission, requireTenant } from "@/lib/request";
import { listCurriculumModules, listQualifications } from "@/lib/authoring";
import { AppShell, Card } from "@/components/app-shell";
import { NewCourseForm } from "./new-course-form";

const COMPONENT_LABELS: Record<string, string> = {
  knowledge: "Knowledge module",
  practical: "Practical skill module",
  workplace: "Workplace experience module",
  general: "General",
};

export default async function NewCoursePage() {
  const tenant = await requireTenant();
  const session = await requirePermission("course:author");

  // Offer every curriculum module across every qualification, so a course can
  // be bound to the accredited unit it delivers at the moment it is created.
  const qualifications = await listQualifications(session);
  const moduleGroups = await Promise.all(
    qualifications.map(async (qualification) => ({
      qualification,
      modules: await listCurriculumModules(session, qualification.id),
    })),
  );

  const options = moduleGroups.flatMap((group) =>
    group.modules.map((module) => ({
      id: module.id,
      label: `${group.qualification.title} — ${module.code} ${module.title} (${
        COMPONENT_LABELS[module.component] ?? module.component
      })`,
    })),
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <h1 className="mb-6 text-xl font-semibold">New course</h1>

      <Card>
        <NewCourseForm curriculumModules={options} />
      </Card>
    </AppShell>
  );
}
