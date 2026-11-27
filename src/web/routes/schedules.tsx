import { createFileRoute } from '@tanstack/react-router';
import styles from './schedules.module.css';

export const Route = createFileRoute('/schedules')({ component: Schedules });

interface Schedule {
  readonly when: string;
  readonly name: string;
  readonly what: string;
  /** The Slack channel the run reports in. */
  readonly where: string;
  /** That channel in Slack. */
  readonly whereUrl?: string;
}

const SCHEDULES: readonly Schedule[] = [
  {
    when: 'Daily, 5:17am New York',
    name: 'Mamurius news update.',
    what: 'Adds new stories and any new Mamurius notebooks to mamurius.com/news as a pull request in jonathannen/mamurius. No pull request on days with nothing new.',
    where: 'MAMURIUS NEWS',
    whereUrl: 'https://jondev.slack.com/archives/C0CM7UZR5QS',
  },
  {
    when: 'Daily, 4:43am New York',
    name: 'Blog maintenance.',
    what: 'Fixes typos in posts and shorts, checks for broken links and compresses new images on jonathannen.com, committed straight to main in jonathannen/jonathannen.com (the steps are its daily-maintenance command). Reports what it fixed and what needs you; one line on days with nothing to do.',
    where: 'JNN BLOG',
  },
  {
    when: 'Daily, 6:34am Sydney',
    name: 'JNN daily traffic assessment.',
    what: 'Posts one short assessment of jonathannen.com traffic from GA4 and Search Console: the last three months against the three before, the last week day by day, and what changed since the previous assessment.',
    where: 'JNN TRAFFIC',
  },
];

/** The scheduled tasks that run for Jon, and where each one reports. */
function Schedules() {
  return (
    <>
      <h1>Schedules</h1>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">What</th>
            <th scope="col">Where</th>
          </tr>
        </thead>
        <tbody>
          {SCHEDULES.map((schedule) => (
            <tr key={schedule.name}>
              <td className={styles.short} data-label="When">
                {schedule.when}
              </td>
              <td data-label="What">
                <span>
                  <b>{schedule.name}</b> {schedule.what}
                </span>
              </td>
              <td className={styles.short} data-label="Where">
                {schedule.whereUrl ? (
                  <a href={schedule.whereUrl} rel="noreferrer" target="_blank">
                    {schedule.where}
                  </a>
                ) : (
                  schedule.where
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
