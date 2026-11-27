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
