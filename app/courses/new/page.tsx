import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { listCurriculumModules, listQualifications } from "@/lib/authoring";
import { vocabulary } from "@/lib/terms";
import { maybe } from "@/lib/i18n";
import { AppShell, Card } from "@/components/app-shell";
import { NewCourseForm } from "./new-course-form";

export default async function NewCoursePage() {
  const tenant = await requireTenant();
  const session = await requirePermission("course:author");
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);

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
      label: t("newCourse.moduleOption", {
        qualification: group.qualification.title,
        code: module.code,
        title: module.title,
        component: maybe(t, `newCourse.component.${module.component}`) ?? module.component,
      }),
    })),
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <h1 className="mb-6 text-xl font-semibold">{t("newCourse.title", { course: words.lowerOne("course") })}</h1>

      <Card>
        <NewCourseForm curriculumModules={options} />
      </Card>
    </AppShell>
  );
}
