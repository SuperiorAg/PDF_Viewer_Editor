import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createTtsVoicePrefsRepo, type TtsVoicePrefsRepo } from './tts-voice-prefs-repo';

describe('tts-voice-prefs-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: TtsVoicePrefsRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createTtsVoicePrefsRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('upsert', () => {
    it('inserts a new row and returns it', () => {
      const row = repo.upsert({
        locale: 'en-US',
        engine_name: 'sapi',
        preferred_voice_id: 'Microsoft David Desktop',
        rate: 1.2,
        pitch: 0.9,
        updated_at: 1000,
      });
      expect(row).toEqual({
        locale: 'en-US',
        engine_name: 'sapi',
        preferred_voice_id: 'Microsoft David Desktop',
        rate: 1.2,
        pitch: 0.9,
        updated_at: 1000,
      });
    });

    it('defaults rate and pitch to 1.0', () => {
      const row = repo.upsert({
        locale: 'en-US',
        engine_name: 'sapi',
        preferred_voice_id: 'Default',
      });
      expect(row.rate).toBe(1.0);
      expect(row.pitch).toBe(1.0);
    });

    it('accepts preferred_voice_id=null (cleared selection)', () => {
      const row = repo.upsert({
        locale: 'en-US',
        engine_name: 'sapi',
        preferred_voice_id: null,
      });
      expect(row.preferred_voice_id).toBeNull();
    });

    it('rejects preferred_voice_id=""', () => {
      expect(() =>
        repo.upsert({
          locale: 'en-US',
          engine_name: 'sapi',
          preferred_voice_id: '',
        }),
      ).toThrowError(/preferred_voice_id/);
    });

    it('updates an existing (locale, engine) pair on re-upsert', () => {
      repo.upsert({
        locale: 'en-US',
        engine_name: 'sapi',
        preferred_voice_id: 'V1',
        rate: 1.0,
        updated_at: 1000,
      });
      repo.upsert({
        locale: 'en-US',
        engine_name: 'sapi',
        preferred_voice_id: 'V2',
        rate: 1.5,
        updated_at: 2000,
      });
      const row = repo.getByKey('en-US', 'sapi');
      expect(row?.preferred_voice_id).toBe('V2');
      expect(row?.rate).toBe(1.5);
      expect(row?.updated_at).toBe(2000);
      // Still one row.
      expect(repo.listAll()).toHaveLength(1);
    });

    it('treats different engines as separate rows', () => {
      repo.upsert({
        locale: 'en-US',
        engine_name: 'sapi',
        preferred_voice_id: 'V1',
      });
      repo.upsert({
        locale: 'en-US',
        engine_name: 'say',
        preferred_voice_id: 'V2',
      });
      expect(repo.listByLocale('en-US')).toHaveLength(2);
    });

    it('treats different locales as separate rows', () => {
      repo.upsert({
        locale: 'en-US',
        engine_name: 'sapi',
        preferred_voice_id: 'V1',
      });
      repo.upsert({
        locale: 'es-ES',
        engine_name: 'sapi',
        preferred_voice_id: 'V2',
      });
      expect(repo.listAll()).toHaveLength(2);
    });

    it('rejects rate outside [0.5, 2.0]', () => {
      expect(() =>
        repo.upsert({
          locale: 'en-US',
          engine_name: 'sapi',
          preferred_voice_id: 'V',
          rate: 0.4,
        }),
      ).toThrowError(/rate/);
      expect(() =>
        repo.upsert({
          locale: 'en-US',
          engine_name: 'sapi',
          preferred_voice_id: 'V',
          rate: 2.1,
        }),
      ).toThrowError(/rate/);
    });

    it('rejects pitch outside [0.5, 2.0]', () => {
      expect(() =>
        repo.upsert({
          locale: 'en-US',
          engine_name: 'sapi',
          preferred_voice_id: 'V',
          pitch: 0.4,
        }),
      ).toThrowError(/pitch/);
    });

    it('rejects an invalid engine name', () => {
      expect(() =>
        repo.upsert({
          locale: 'en-US',
          // @ts-expect-error — deliberately invalid
          engine_name: 'azure',
          preferred_voice_id: 'V',
        }),
      ).toThrowError(/engine_name/);
    });
  });

  describe('getByKey / listByLocale / listAll', () => {
    it('getByKey returns null for an unknown key', () => {
      expect(repo.getByKey('zz-ZZ', 'sapi')).toBeNull();
    });

    it('listByLocale orders by engine_name ASC', () => {
      repo.upsert({ locale: 'en-US', engine_name: 'say', preferred_voice_id: 'V1' });
      repo.upsert({ locale: 'en-US', engine_name: 'sapi', preferred_voice_id: 'V2' });
      repo.upsert({ locale: 'en-US', engine_name: 'espeak', preferred_voice_id: 'V3' });

      const list = repo.listByLocale('en-US').map((r) => r.engine_name);
      expect(list).toEqual(['espeak', 'sapi', 'say']);
    });
  });

  describe('deleteByKey', () => {
    it('removes a specific (locale, engine) row', () => {
      repo.upsert({ locale: 'en-US', engine_name: 'sapi', preferred_voice_id: 'V' });
      expect(repo.deleteByKey('en-US', 'sapi')).toBe(1);
      expect(repo.getByKey('en-US', 'sapi')).toBeNull();
    });

    it('returns 0 for an unknown key', () => {
      expect(repo.deleteByKey('zz-ZZ', 'sapi')).toBe(0);
    });
  });
});
