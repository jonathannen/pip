import { createFileRoute } from '@tanstack/react-router';
import { list, timesIn, ZONES } from '../schedule-times';
import styles from './schedules.module.css';

export const Route = createFileRoute('/schedules')({ component: Schedules });

interface Schedule {
  /** The times of day it runs, every day, as `HH:MM` on the clock in `timeZone`. */
  readonly times: readonly string[];
  /** The time zone it was set in, which its runs follow through clock changes. */
  readonly timeZone: string;
  readonly name: string;
  readonly what: string;
  /** The Slack channel the run reports in. */
  readonly where: string;
  /** That channel in Slack. */
  readonly whereUrl: string;
}

const SCHEDULES: readonly Schedule[] = [
  {
    times: ['05:17'],
    timeZone: 'America/New_York',
    name: 'Mamurius news update.',
    what: 'Adds new stories and any new Mamurius notebooks to mamurius.com/news as a pull request in jonathannen/mamurius. No pull request on days with nothing new.',
    where: 'MAMURIUS NEWS',
    whereUrl: 'https://jondev.slack.com/archives/C0CM7UZR5QS',
  },
  {
    times: ['04:43'],
    timeZone: 'America/New_York',
    name: 'Blog maintenance.',
    what: 'Fixes typos in posts and shorts, checks for broken links and compresses new images on jonathannen.com, committed straight to main in jonathannen/jonathannen.com (the steps are its daily-maintenance command). Reports what it fixed and what needs you; one line on days with nothing to do.',
    where: 'JNN BLOG',
    whereUrl: 'https://jondev.slack.com/archives/C0CKTP9RRM4',
  },
  {
    times: ['06:34'],
    timeZone: 'Australia/Sydney',
    name: 'JNN daily traffic assessment.',
    what: 'Posts one short assessment of jonathannen.com traffic from GA4 and Search Console: the last three months against the three before, the last week day by day, and what changed since the previous assessment.',
    where: 'JNN TRAFFIC',
    whereUrl: 'https://jondev.slack.com/archives/C0CKCJ2E05U',
  },
  {
    times: ['07:36', '12:36', '17:36'],
    timeZone: 'America/Los_Angeles',
    name: 'Social interactions check.',
    what: 'Checks Hacker News, Lobsters, LinkedIn and X for replies to Jon and for posts worth engaging with, and drafts replies and comments, which he posts himself. Reports as one numbered list, with the drafts to copy in its thread. Announces each new jonathannen.com post or short on LinkedIn, X and Bluesky, gives the daily submission picks on the first run of the day, and commits post stats to memory/social.md in jonathannen/jonathannen.com. Nothing outside 7am to 7pm where Jon is.',
    where: 'JNN SOCIAL',
    whereUrl: 'https://jondev.slack.com/archives/C0CKEA9KW90',
  },
];

/** The scheduled tasks that run for Jon, when on the clocks he keeps, and where each one reports. */
function Schedules() {
  const now = new Date();
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
                <span>
                  Daily
                  {ZONES.map((zone) => (
                    <span className={styles.zone} key={zone.timeZone}>
                      {list(timesIn(schedule.times, schedule.timeZone, zone.timeZone, now))}{' '}
                      {zone.label}
                    </span>
                  ))}
                </span>
              </td>
              <td data-label="What">
                <span>
                  <b>{schedule.name}</b> {schedule.what}
                </span>
              </td>
              <td className={styles.short} data-label="Where">
                <a href={schedule.whereUrl} rel="noreferrer" target="_blank">
                  {schedule.where}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
