-- 139 Add Turkish airports (cities with scheduled + Umrah-charter flights to Saudi
-- Arabia) so they can be selected as Origin/Destination in the visa form. IST & SAW
-- already existed. Idempotent insert — skips codes already present.
-- (Applied via Supabase MCP; full VALUES list in project migration 139.)
insert into airports (code, name, city, country, is_saudi)
select v.code, v.name, v.city, 'Turkey', false
from (values
  ('ESB','Ankara Esenboga','Ankara'),('ADB','Izmir Adnan Menderes','Izmir'),
  ('AYT','Antalya','Antalya'),('GZP','Gazipasa-Alanya','Alanya'),
  ('ADA','Adana Sakirpasa','Adana'),('COV','Cukurova','Adana / Mersin'),
  ('GZT','Gaziantep Oguzeli','Gaziantep'),('SZF','Samsun Carsamba','Samsun'),
  ('TZX','Trabzon','Trabzon'),('OGU','Ordu-Giresun','Ordu'),
  ('KYA','Konya','Konya'),('ASR','Kayseri Erkilet','Kayseri'),
  ('NAV','Kapadokya (Nevsehir)','Nevsehir'),('VAS','Sivas Nuri Demirag','Sivas'),
  ('DIY','Diyarbakir','Diyarbakir'),('VAN','Van Ferit Melen','Van'),
  ('ERZ','Erzurum','Erzurum'),('EZS','Elazig','Elazig'),
  ('MLX','Malatya','Malatya'),('GNY','Sanliurfa GAP','Sanliurfa'),
  ('MQM','Mardin','Mardin'),('BAL','Batman','Batman'),
  ('KCM','Kahramanmaras','Kahramanmaras'),('HTY','Hatay','Hatay'),
  ('DNZ','Denizli Cardak','Denizli'),('DLM','Dalaman','Mugla'),
  ('BJV','Bodrum-Milas','Bodrum'),('YEI','Bursa Yenisehir','Bursa'),
  ('KSY','Kars Harakani','Kars'),('IGD','Igdir','Igdir'),
  ('MSR','Mus','Mus'),('AJI','Agri Ahmed-i Hani','Agri'),
  ('BGG','Bingol','Bingol'),('ISE','Isparta Suleyman Demirel','Isparta'),
  ('EDO','Balikesir Koca Seyit','Edremit'),('TEQ','Tekirdag Corlu','Tekirdag')
) as v(code, name, city)
where not exists (select 1 from airports a where a.code = v.code);
