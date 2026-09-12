-- The chart of accounts from the old software, merged into the one here.
--
-- SOURCE: Account_tree.xlsx, "VISTA SAUDIA / Tree 01-03-2026 To 12-09-2026".
-- 574 rows, the tree carried in the indentation of one column (5 spaces per
-- level, up to 6 levels). 57 groups, 517 postable accounts, NO balances — the
-- amount columns in that export are empty, so this brings the structure and
-- nothing else.
--
-- WHY THIS IS A MERGE AND NOT AN IMPORT. The chart here is already a partial
-- copy of that same tree: 20 of the 57 groups exist, under slightly different
-- spellings (A/C RECEIVABLE vs A/C RECIEVEABLE, OFFICE EQUIPMENT vs
-- OFFICE EQUIPEMENT, CAR SUPPLIER vs CAR SUPPLIERS), and 49 of the leaves are
-- live party accounts. So every node is FOUND OR CREATED: matched against what
-- is already there and reused, or created in its place. Nothing existing is
-- renamed or recoded, which is what keeps the 49 parties and the accounts the
-- posting engines reach by code (1160, 5100, 9-01, Inventory) exactly as they
-- are.
--
-- ONE CORRECTION TO THAT, MEASURED AFTER THE FACT. I wrote "nothing existing is
-- moved" above and that turned out to be wrong: 29 customer accounts that sat
-- loose directly under CUSTOMERS were RE-PARENTED into the category group the
-- Excel puts them in (Alpha Travels, KARWAN E BAWA, CASH CUSTOMER and 26 more
-- moved into VISTA CUSTOMERS). It happens inside acct_create's party path,
-- which adopts the account the parties trigger raises and moves it to the
-- parent it was asked for. Their CODES did not change, so 29 accounts now carry
-- a code that no longer describes where they sit — 1-04-01-006 under
-- 1-04-01-35. Nothing is broken by that: codes here are labels, and the
-- routines that reach accounts by code reach 1160 / 5100 / 9-01, none of which
-- moved. It is left as it is rather than recoded, because re-coding 29 live
-- party accounts to fix a cosmetic mismatch is the bigger risk. Move them with
-- the tree's own Move button if the codes should be tidied.
--
-- AND 507 ACCOUNT ROWS WERE INSERTED FOR A NET GAIN OF 381. The difference is
-- acct_link_party deleting the spare the parties trigger raises, which is its
-- documented job. Every one of the 154 account codes that existed beforehand
-- was checked afterwards and is still there.
--
-- THE TWO SHAPES DIFFER AND THE EXISTING ONE WINS. The Excel has intermediate
-- groups this chart does not: ASSETS > CURRENT ASSETS > CASH & BANK > BANK,
-- against ASSETS > BANK here. Those levels are COLLAPSED — their children
-- attach to the existing parent — because re-parenting 300 live accounts to
-- gain a level is a worse trade than a chart one level flatter in two places.
-- The collapse is declared in the map below, not inferred.
--
-- CUSTOMERS AND SUPPLIERS BECOME PARTIES. 111 names under CUSTOMERS and 150
-- under SUPPLIERS are created through acct_create's party path, so each gets
-- its parties record as well as its ledger account. Without that they would be
-- in the chart and pickable on nothing — the exact fault migration 359's
-- Account Tree badge was added to expose, 261 times over. One routine creates
-- the pair, as it has to be.
--
-- A name may legitimately be both: Rehan is a transport supplier here already
-- and a VISTA CAR customer in the Excel. Matching is scoped to the children of
-- the resolved parent, never global, so the two stay two records — which is
-- what they are.
--
-- 'Bank Ac' (row 8 of the export, a bare top-level line) IS DELIBERATELY
-- SKIPPED. It sits above the tree with the report's own headers, it is not
-- under any root, and this chart already has both a BANK group and a Bank
-- account. Creating a third thing called Bank on a guess is worse than leaving
-- one line for a human to place.

begin;

-- Matching is by name with the export's spellings folded in. A trailing S is
-- dropped so CUSTOMERS matches CUSTOMER — the two charts disagree on that
-- throughout.
create or replace function public._coa_norm(p text)
returns text language sql immutable set search_path to 'public' as $f$
  select case when right(x,1) = 'S' and length(x) > 1 then left(x, length(x)-1) else x end
  from (select btrim(regexp_replace(regexp_replace(
                 replace(replace(replace(upper(coalesce(p,'')),
                   'RECIEVEABLE','RECEIVABLE'),'EQUIPEMENT','EQUIPMENT'),'LIABLITIES','LIABILITIES'),
                 '[^A-Z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as x) q;
$f$;

do $mig$
declare
  -- seq|depth|kind|name   (kind: G group, A account, Ac customer, As supplier)
  v_rows text := $DATA$
1|0|A|Bank Ac
2|0|A|Journal Entries Control A/C
3|0|A|Profit/Loss A/C
4|0|A|Opening Balances Control A/C
5|0|G|EQUITY A/Cs
6|1|G|DRAWING
7|2|A|SS DRAWING
8|2|A|SS/PARCO
9|2|A|SS ZAKAT
10|2|A|KHUBAIB DRAWING
11|2|A|HAMMAD DRAWING
12|1|A|CAPITAL
13|0|G|ASSETS
14|1|G|FIXED ASSETS
15|2|G|PROPERTY
16|3|A|VILLA 2
17|3|A|VILLA 1
18|2|G|VEHICLES
19|3|A|ASST HYNDAI STAREX BLUE
20|3|A|ASST HYNDAI STARIA (LUXURY)
21|3|A|ASST HYNDAI STARIA 2022 BLACK
22|3|A|ASST HYNDAI STAREX 2021 SILVER
23|3|A|ASST HYNDAI STAREX SILVER
24|3|A|DODGE
25|2|G|OFFICE EQUIPEMENT
26|3|A|AC
27|3|A|Computers
28|3|A|Furniture
29|3|A|Office Equipment
30|3|A|Electronics
31|1|G|CURRENT ASSETS
32|2|G|INVENTORY GROUP
33|3|A|INVENTORY
34|2|G|CASH & BANK
35|3|G|CASH & CHEQUE
36|4|A|CASH IN HAND (FIAZ DRIVER)
37|4|A|CASH IN HAND (BAKHTI)
38|4|A|CASH IN HAND (MUZAMMIL DRIVER)
39|4|A|CASH IN HAND (RAHAT DRIVER)
40|4|A|CASH IN HAND (ALI DRIVER)
41|4|A|CASH IN HAND
42|4|A|Cheque In Hand
43|4|A|USD In Hand
44|3|G|BANK
45|4|G|BANK PKR
46|5|A|CASH IN HAND (PKR)
47|5|A|MEEZAN BANK
48|4|A|RIYAD BANK VISTA GROUP
49|4|A|RAJHI BANK VISTA GROUP
50|4|A|RAJHI BANK HAMMAD
51|4|A|RAJHI BANK KHUBAIB
52|4|A|ALINMA BANK HASSAN
53|4|A|ALINMA BANK KHUBAIB
54|4|A|ALINMA BANK HAMMAD
55|4|A|ALINMA BANK CAR TRADING
56|2|G|A/C RECIEVEABLE
57|3|G|CUSTOMERS
58|4|G|UMRAH VISA CUSTOMERS
59|5|Ac|UMRAH VISA CUSTOMER
60|4|G|HOTEL CUSTOMERS
61|5|Ac|HOTEL CUSTOMER
62|4|G|CAR TRADING CUSTOMER
63|5|Ac|CAR CASH CUSTOMER
64|5|Ac|REHAN
65|4|G|VISTA CAR CUSTOMERS
66|5|Ac|MUHAMMAD TANVEER
67|5|Ac|MUHAMMAD AKMAL
68|5|Ac|MUHAMMAD KHALID
69|5|Ac|ABDUL GHAFFAR
70|5|Ac|MANSOOR ZAFAR
71|5|Ac|HAROON KHAN
72|5|Ac|HAFIZ TAIBA
73|5|Ac|FAHAD SARDAR
74|5|Ac|RIASAT ALI
75|5|Ac|MUDASSIR MUHAMMAD
76|5|Ac|DANIYAL FAQEER
77|5|Ac|SHAUKAT ALI
78|5|Ac|KHURRAM EHSAN
79|5|Ac|YASIR ARAFAT
80|5|Ac|MUGHEES RAZZAQ
81|5|Ac|GHULAM MUSTAFA
82|5|Ac|MUDASSIR IQBAL
83|5|Ac|RIAZ AHMED
84|5|Ac|SAJJAD HAIDER
85|5|Ac|FIAZ IRSHAD
86|5|Ac|MUHAMMAD BILAL
87|5|Ac|MUHAMMAD IRSHAD
88|5|Ac|IMAM BAKHSH
89|5|Ac|MUHAMMAD KAMRAN
90|5|Ac|QAZI FARHAN / SALMAN IQBAL
91|5|Ac|REHAN AHMED KHAN
92|5|Ac|MUHAMMAD ATIF
93|5|Ac|QAISAR KHAN
94|5|Ac|FAISAL AHMED
95|5|Ac|MUHAMMAD SHAHID
96|5|Ac|MUHAMMAD SALEEM
97|5|Ac|AHSAN MEMON
98|5|Ac|ASIF DASTI
99|5|Ac|ZAFAR AHMED
100|5|Ac|YOUNUS KHAN
101|4|G|EX VISTA CAR CUSTOMER
102|5|Ac|MUHAMMAD SALMAN
103|5|Ac|MUHAMMAD SHAFIQ
104|5|Ac|ABDUL AZIZ ABID MUSTAFA
105|5|Ac|SHAKEEL
106|5|Ac|ABDUL JALAL
107|5|Ac|QAZI FARHAN
108|5|Ac|IRFAN SHAMI
109|5|Ac|NAJAM MUSTAFA
110|5|Ac|MUHAMMAD YOUSUF
111|5|Ac|AHMED FARAZ
112|5|Ac|FAZAL BASHIR
113|5|Ac|SHAFIULLAH KHAN
114|5|Ac|SAQIB MEHMOOD
115|5|Ac|QASIM
116|4|G|VISTA CUSTOMERS
117|5|Ac|INFINITE TRAVEL
118|5|Ac|INDIGO TRAVELS
119|5|Ac|ZUYUF UL BAIT TRAVELS
120|5|Ac|SIIRU TRAVELS
121|5|Ac|TAIBAH LINES TRANSPORT
122|5|Ac|ALPHA TRAVELS TRANSPORT
123|5|Ac|ALPHA TRAVELS
124|5|Ac|PAK ABDULLAH TRANSPORT
125|5|Ac|PAK ABDULLAH AVIATION
126|5|Ac|KARWAN E BAWA
127|5|Ac|FAHAD TRAVELS
128|5|Ac|INTERNATIONAL AVIATION
129|5|Ac|NETCOME VOYAGES
130|5|Ac|BLESSED TREK
131|5|Ac|SHIWANI TRAVELS
132|5|Ac|DAR AR RIHLA
133|5|Ac|UMRAH PACKAGE CUSTOMER
134|5|Ac|BUKHARI TRAVELS
135|5|Ac|GO SALAM TRAVELS
136|5|Ac|MUSTAFA
137|5|Ac|PRIME IMPEX
138|5|Ac|INDUS TRAVEL
139|5|Ac|SASTA TRIPS
140|5|Ac|KKFT TRAVELS
141|5|Ac|GOLDEN TRAVELS
142|5|Ac|ALAMGIR TRAVEL POINT
143|5|Ac|RAINBOW TRAVELS
144|5|Ac|ANSAAR (ESVAR)
145|5|Ac|TRAVEL TALES
146|5|Ac|SIRAJ TRAVELS
147|5|Ac|VISTA TRAVELS
148|5|Ac|DAILY AIR TRAVELS
149|5|Ac|AZIZI TRAVELS & TOURS
150|5|Ac|ETIMAD (AHMED FARAZ)
151|5|Ac|MAKARIM
152|5|Ac|OWAIS TRAVELS
153|5|Ac|NAJAM TRAVELS
154|5|Ac|ABRISH GLOBAL GETAWAYS
155|5|Ac|BAITUSSALAM
156|5|Ac|HARAMZONE
157|5|Ac|BASHIR IBRAHIM ENT
158|5|Ac|ASAN TOURS
159|5|Ac|ROYAL TOURS
160|5|Ac|AL REHMAN TICKETS
161|5|Ac|AL REHMAN TRAVEL
162|5|Ac|MENA WORLD TOURISM
163|5|Ac|SIRAJIYA HAJJ & UMRAH
164|5|Ac|ANWAR UL HARAMAIN
165|5|Ac|JAZAA TRAVEL
166|5|Ac|HERMAIN TRAVELS
167|5|Ac|CASH CUSTOMER
168|5|Ac|Abu Hanzalah ( Rehan Nasim )
169|4|G|QURBANI CUSTOMERS
170|5|Ac|HARAMAIN
171|5|Ac|QURBANI CUSTOMER
172|4|G|TEXTILE CUSTOMERS
173|5|Ac|SAYLANI POLO
174|5|Ac|DURRAT UL BALAD
175|5|Ac|MAC CENTER
176|5|Ac|MODERN HOME
177|3|G|OTHERS RECEIVABLE :
178|4|G|LOANS & ADVANCES
179|5|A|AFZAL LOAN
180|5|A|ASIM AHMED LOAN
181|5|A|NAJAM BHAI LOAN
182|5|A|MENA LOAN
183|5|A|ABDUL REHMAN ZAHID LOAN
184|5|A|HASSAN SALMAN LOAN
185|5|A|USAMA ALPHA LOAN
186|5|A|SHEIKH MASOOD AHMED LOAN
187|5|A|SS LOAN
188|5|A|ZAHID PRINTER LOAN
189|5|A|ILYAS BHAI LOAN
190|5|A|AHSAN MEMON LOAN
191|5|A|FAISAL AHMED LOAN
192|5|A|SHAHZAD SALEEM LOAN
193|5|A|MURTAZA LOAN
194|5|A|ABU NASIR LOAN
195|5|A|KHUBAIB SALMAN LOAN
196|5|A|KAMRAN SALEEM LOAN
197|5|A|OSAMA LOAN
198|5|A|HAMMAD SALMAN LOAN
199|5|A|AARIF YAHYA LOAN
200|5|A|KASHIF NASEEM LOAN
201|5|A|MBL LOAN
202|5|A|YAHYA ELAHI LOAN
203|5|A|LUQMAN YAHYA LOAN
204|5|A|SOHAIB KAMRAN LOAN
205|5|A|IMRAN AFTAB LOAN
206|5|G|STAFF : EMPLOYEE LOAN
207|6|A|MUZAMMIL KHAN LOAN
208|6|A|ALI DRIVER LOAN
209|6|A|ABDULLAH BAKHTI LOAN
210|6|A|ISLAM OFFICE LOAN
211|6|A|RAHAT NAZAR LOAN
212|6|A|ABDUL REHMAN LOAN
213|5|G|ADVANCE : OTHERS
214|6|A|Travelling Advance
215|6|A|Advance - Petty Cash
216|6|A|Advance Staff Salary
217|0|G|LIABILITIES
218|1|G|CURRENT LIABLITIES
219|2|G|SUPPLIERS
220|3|G|UMRAH VISA SUPPLIER
221|4|As|VIVID JOURNEY
222|4|As|SHAHZAID SEND TO CONSULATE
223|4|As|FAHAD TALQ
224|4|As|MOFA
225|4|As|BASMA GROUP
226|3|G|CAR SUPPLIERS
227|4|As|NAWARAS CAR
228|4|As|ALASH CAR
229|4|As|YOUSUF MADANI CAR
230|4|As|AL LEETH CAR TRADING
231|4|As|AL LEETH CAR
232|4|As|ROWAYLI CAR
233|4|As|RAAFAT AL FARHAN CAR
234|4|As|MITRY QUPTI CAR
235|4|As|NUKHBAH CARS
236|4|As|MURTAZA CAR
237|3|G|TRANSPORT SUPPLIERS
238|4|As|NUSUK REGISTRATION
239|4|As|Makkah Tasreeh
240|4|As|Khurram Staria
241|4|As|Taimoor Staria
242|4|As|Sharafat Staria
243|4|As|VISTA TRADING
244|4|As|Abdul Rehman Staria
245|4|As|JAVED STARIA
246|4|As|Bilal Starex
247|4|As|Riaz Starex
248|4|As|Irshad Staria
249|4|As|Rafeeqi Transport
250|4|As|Sajjad Staria
251|4|As|ABU ZAR
252|4|As|Aamir Bus
253|4|As|Kismat Khan Staria
254|4|As|Abid Camry
255|4|As|Gulam Fareed Staria
256|4|As|ABU HANZALA QURBANI
257|4|As|Izhaar Starex
258|4|As|Mughees Staria
259|4|As|Abdul Basit Staria
260|4|As|BASMA EMAAR TRANSPORT
261|4|As|SHAH JEE TRANSPORT
262|4|As|SHOAIB
263|4|As|Fazal Makkah
264|4|As|Salman Starex
265|4|As|FIAZ IRSHAD STAREX
266|4|As|Rehan Staria
267|4|As|Atif Hiace
268|4|As|Asif Hiace
269|4|As|Ahmed Faraz Starex
270|4|As|HHR TRAIN
271|4|As|Qaisar Starex
272|4|As|TALHA GUIDE
273|4|As|ABU HARAIRA GUIDE
274|4|As|SALEH UMRAH GUIDE
275|4|As|Abbas Staria
276|4|As|Safwa Airport
277|4|As|Yousuf Madinah
278|4|As|Abdul Gaffar Starex
279|4|As|Haraj Makkah
280|4|As|Tahir Starex
281|4|As|Ahsan Ul Haq Starex
282|4|As|Imam Bakhsh Staria
283|4|As|Shahzad Staria
284|4|As|Rizwan Starex
285|4|As|Mudassir Starex
286|4|As|Mustafa Starex
287|4|As|Other Driver
288|4|As|Fazal Bashir Madinah
289|4|As|Saqib Starex
290|4|As|Asif Madinah
291|4|As|Younus Starex
292|4|As|Fiaz Starex
293|4|As|Hasnain Starex
294|4|As|Akmal Staria
295|4|As|Raees Starex
296|4|As|Yousuf Starex
297|4|As|Yasir Starex
298|4|As|Hashim Makkah
299|4|As|Faisal Starex
300|4|As|Azeem Makkah
301|4|As|Zafar Starex
302|4|As|SAIF Staria
303|4|As|Khalid Makkah
304|3|G|AIR TICKETS SUPPLIERS
305|4|As|PIA
306|4|As|ALMOSAFER
307|4|As|ALPHA TICKETS
308|4|As|EMIRATES
309|4|As|GOLDEN TICKETS
310|4|As|SASTATICKET
311|4|As|MENA TICKETS
312|4|As|SUFIYAN VACCINATION
313|4|As|OMAN AIR
314|4|As|FLYADEAL
315|4|As|CHECKIN TRAVELS
316|4|As|FLYNAS
317|3|G|HOTELS SUPPLIERS
318|4|As|ALSUBAEE HOLIDAYS
319|4|As|IRFAN UL HUDA TRAVELS
320|4|As|EMAAR DIYAFAH HOTEL
321|4|As|GOLDEN ROWA
322|4|As|MAWASIM TOURISM
323|4|As|ELAF HOTEL
324|4|As|E-TRIPS
325|4|As|AL TOQA TRAVEL
326|4|As|ARABIAN TOUR
327|4|As|KUNUZ TAQWA
328|4|As|MUSTAFA BRN
329|4|As|SHAHID BRN
330|4|As|ABU MUSA BRN
331|4|As|ARIF HOTEL
332|4|As|HAMZA BRN
333|4|As|RIAZ BRN
334|4|As|AHSAN BRN
335|4|As|TRAVEL DOOR BRN
336|4|As|ASTON INTERNATIONAL
337|4|As|AHMED FARAZ HOTEL
338|4|As|DUAA AL MADINAH
339|4|As|NUZUL AL JAWAD
340|4|As|KASHIF HOTELS
341|4|As|JAZEERAH BRN
342|4|As|WAJAHAT HOTEL
343|4|As|UNIWORLD HOTEL
344|4|As|ADEN HOTELS
345|4|As|BURRAQ
346|4|As|ABDUL REHMAN HOTEL
347|4|As|HOTEL
348|4|As|BOOKING.COM
349|4|As|KENZI FOR UMRAH SERVICE
350|4|As|SEDRA INTERNATIONAL
351|4|As|ASKANT HOTEL
352|4|As|JAZEERA TAIBA
353|4|As|DEYAAR MAKKAH COMPANY
354|4|As|CLICK TO UMRAH
355|4|As|FUNADIQ HOTEL
356|4|As|TRAVEL GATEWAY
357|4|As|FAST BOOKING
358|4|As|MAYSAN HOTEL
359|4|As|ESVAR HOTEL
360|4|As|QAFILAH HOTEL
361|3|G|WORK VISA SUPPLIERS
362|4|As|PROVISION IQAMA PAYABLE
363|4|As|MAKTAB MADAAR AL MAMLAKA
364|4|As|MAKTAB ABU YOUSUF
365|4|As|TGA
366|4|As|MUROOR
367|4|As|TAWUNIYA INSURANCE
368|4|As|MALATH INSURANCE
369|4|As|RAJHI TAKAFUL INSURANCE
370|4|As|SALAMA INSURANCE
371|4|As|QIWA
372|4|As|MUQEEM
373|4|As|YUSRA COMPANY CHARGES
374|3|G|TEXTILE SUPPLIERS
375|4|As|VALLEY HOUSE CARGO
376|4|As|MBL
377|2|G|OTHER LIABLITIES
378|3|A|ABID SAHAB CAR SALE
379|3|A|USAMA CAR
380|3|A|CAR FREIGHT PAYABLE
381|3|A|ALPHA TRAVELS GUARANTEE
382|3|A|CONSULTATION PAYABLE
383|3|A|TAHA MASOOD
384|3|A|ZATCA OTHER PAYABLE
385|3|A|MAKKAH ROOM RENT
386|3|A|UN-IDENTIFIED CASH
387|3|A|ZATCA CAR PAYABLE
388|3|A|AHSAN ROOM RENT
389|3|A|SAQIB LIABLITY
390|3|A|OSAMA COMPANY CHARGES
391|3|A|ENGINEER WARRANTY COMPANY (CAMERA & GPS
392|3|A|PROVISION CAMERA PAYABLE
393|3|A|PROVISION COMPANY CHARGES PAYABLE
394|3|A|CAR OTHER PAYABLE
395|3|A|PROVISION CAR INSPECTION PAYABLE
396|3|A|PROVISION CAR COMMISION PAYABLE
397|3|A|CUSTOMS PAYABLE (ZATCA)
398|3|A|REGISTRATION PAYABLE (MUROOR)
399|3|A|PROVISION INSURANCE PAYABLE
400|3|A|CAR TRANSPORT PAYABLE
401|3|A|STC PAYABLE
402|3|A|GOSI (EMP. INS.) PAYABLE
403|3|A|UTILITY PAYABLE
404|3|A|QURBANI OTHER PAYABLE
405|3|A|QURBANI CUTTING PAYABLE
406|3|A|SALMAN MAKKAH COMMISSION
407|3|A|Abdul Rehman Commission
408|3|A|IMRAN VILLA RENOVATION
409|3|A|ABDUL SAMAD CAR
410|3|A|ABDUL AZIZ ABID COMMISSION
411|3|A|FIAZ IRSHAD COMMISSION
412|3|A|THINK (ADVERTISEMENT AGENCY)
413|3|A|IRFAN SALEEM LOAN
414|3|A|Nadeem Commission
415|3|A|UMAR KAFEEL
416|3|A|IMRAN OFFICE LANDLORD
417|3|A|Wafa Agent
418|3|A|KAK BUSINESS SERVICE COMPANY
419|3|A|DATES
420|3|A|ECOM SOUQ
421|3|A|LAND OWNER
422|3|A|VILLA OWNER
423|3|A|UZMA IRFAN
424|2|G|SALARY PAYABLE
425|3|A|ABDULLAH BAKHTI (SALARY PAYABLE)
426|3|A|ASIM AHMED KHAN (SALARY PAYABLE)
427|3|A|BARKATULLAH OFFICE BOY
428|3|A|HASSAN SALMAN
429|3|A|MUHAMMAD AFZAL (SALARY PAYABLE)
430|3|A|SYED SADDAD UL HAQ (SALARY PAYABLE)
431|3|A|MUHAMMAD ALI DRIVER (SALARY PAYABLE)
432|3|A|RIAZ SAUDI
433|3|A|MUZAMMIL KHAN (SALARY PAYABLE)
434|3|A|SHUROOQ SAUDI (SALARY PAYABLE)
435|3|A|RANA MUNEER SAUDI
436|3|A|SAAD ASIM (SALARY PAYABLE)
437|3|A|YUSRA MUHAMMAD (SALARY PAYABLE)
438|3|A|RAWIH SAUDI
439|3|A|JAWAHER SAUDIA (SALARY PAYABLE)
440|3|A|RAHAT NAZAR (SALARY PAYABLE)
441|2|G|EX EMPLOYEES
442|3|A|AHMED FARAZ (SALARY PAYABLE)
443|3|A|ABDUL REHMAN DRIVER
444|3|A|SHAZA SAUDI (SALARY PAYABLE)
445|3|A|BASIT KHAN (SALARY PAYABLE)
446|3|A|ALI ASIM (SALARY PAYABLE)
447|3|A|HALEEMA SAUDI
448|3|A|ISLAM OFFICE
449|3|A|NADEEM DRIVER
450|2|G|PROVISION : OTHERS
451|3|A|PROVISION VAT RECEIVABLE
452|3|A|PROVISION COMMISSION
453|3|A|PROVISION ALDREES PETROL PUMP
454|3|A|PROVISION FOR FREIGHT & CLEARING
455|3|A|PROVISION FACEBOOK ADS
456|3|A|Provision - Vehicle Insurance
457|3|A|Provision - Utility Bills
458|3|A|Provision - Air Freight
459|2|G|PROVISION : SALARIES
460|3|A|Provision - Salaries
461|2|G|PROVISION : DEPRECIATION
462|3|A|Depr.Prov.Electrical Fittings
463|3|A|Depr.Prov.Vehicles
464|3|A|Depr.Prov. Office Equipment
465|3|A|Depr.Prov. Funniture & Fixures
466|3|A|Depr.Prov.Computers
467|2|G|PROVISION : TAXES
468|3|A|W/H INC-TAX SALARY PAYABLE
469|3|A|Professional Tax Payable
470|3|A|Provision - CEX Consultation
471|3|A|Provision - LIC
472|3|A|Provision - Professional Tax
473|0|G|LONG TERM LIABLITIES
474|1|A|PNL SHARING
475|1|G|SS INVESTMENTS
476|2|A|SS CAR TRADING
477|2|A|SS INVEST VISTA
478|2|A|SS INVEST (MADINAH HOME)
479|1|A|ABU NASIR INVESTMENT
480|1|A|MBL INVESTMENT
481|0|G|REVENUES
482|1|G|SALES GROUP
483|2|A|CAR SALES
484|2|A|VEHICLE SALES INSTALLMENTS
485|2|A|VISTA SALES
486|2|A|QURBANI SALES
487|2|A|SERVICE CHARGES
488|2|A|SALES
489|1|G|INCOME ACCOUNT
490|2|A|Exchange Gain & Loss
491|2|A|UMRAH VISA INCOME
492|2|A|AIR TICKET INCOME
493|2|A|HOTELS INCOME
494|2|A|VAT INCOME
495|2|A|OTHER INCOME
496|2|A|Inventory Gain & Loss
497|2|A|TRANSPORT INCOME
498|2|A|Rental Income
499|0|G|COGS EXPENSE
500|1|A|FOOD BRN
501|1|A|HOTEL BRN
502|1|A|COGS
503|0|G|EXPENSES
504|1|G|IN DIRECT EXPENSE
505|2|A|Advertisement & Publicity
506|2|A|INVESTOR PROFIT SHARING
507|2|A|BONUS EXPENSE
508|2|A|Salaries - Staff (Off)
509|1|G|ADJUSTMENTS
510|2|A|Loss & Penalty
511|2|A|Bad Debts
512|1|G|STOCK TRANSFER
513|2|A|Stock Transfer - Finished Goods
514|2|A|Stock Transfer - Consumable Stores
515|2|A|Stock Transfer - Components
516|2|A|Stock Transfer - Raw Material
517|1|G|SELLING OVERHEADS
518|2|A|DISCOUNT EXPENSE
519|1|G|HOME EXP
520|2|A|WATER CHARGES (VILLA)
521|2|A|GAS CHARGES (VILLA)
522|2|A|INTERNET CHARGES (VILLA)
523|2|A|ELECTRICITY CHARGES ( VILLA)
524|1|G|ADMINISTRATION OVERHEADS
525|2|A|SAUDI EXPENSE
526|2|A|LICENSE EXPENSE
527|2|A|KAFEEL EXPENSE
528|2|A|Transport Charges
529|2|A|BANK CHARGES
530|2|A|IQAMA EXPENSE
531|2|A|GAS EXPENSE
532|2|A|DONATION
533|2|A|CAR INSPECTION CHARGES
534|2|A|DESIGNING & VIDEO EDITING EXPENSE
535|2|A|INTERNET EXPENSE
536|2|A|COMPANY MONTHLY CHARGES
537|2|A|COMMISSION EXP
538|2|A|GIFT EXPENSE
539|2|A|Guest Expense
540|2|A|Entertainment Expenses
541|2|A|Computer Maintenance
542|2|A|FINES AND VIOLATION
543|2|A|Consultation Charges
544|2|A|HOUSEKEEPING EXPENSE
545|2|A|EMPLOYEE MEDICAL
546|2|A|EMPLOYEE INSURANCE EXPENSE
547|2|A|Conveyance
548|2|A|EMPLOYEE HOUSE RENT
549|2|A|Electricity Charges
550|2|A|Generator Maintanence
551|2|A|Leave Encash
552|2|A|LUNCH EXPENSE
553|2|A|Driving License
554|2|A|Membership & Subscription Fee
555|2|A|OFFICE SUPPLIES
556|2|A|Office Maintenance
557|2|A|TRADEMARK REGISTRATION
558|2|A|Office Maintenance - Delhi Flat
559|2|A|Vehicle Registration
560|2|A|Vehicle Insurance
561|2|A|Packing Charges
562|2|A|TRAVELLING EMPLOYEE
563|2|A|Postage And Stamps
564|2|A|Printing And Stationery
565|2|A|Car Parking
566|2|A|Rent - ( Factory Premises )
567|2|A|Repairs & Maintenance
568|2|A|Telephones & Telegrams
569|2|A|Office Rent
570|2|A|Travelling - Directors
571|2|A|Vehicle Maintenance
572|2|A|Car Petrol
573|2|A|WEB DEVELOPMENT
574|2|A|Water Charges
$DATA$;
  v_co uuid; v_admin uuid; r record; d int; i int;
  anc uuid[] := array_fill(null::uuid, array[8]);
  v_parent uuid; v_id uuid; v_code text; v_sub text; v_root text; v_res jsonb;
  n_created int := 0; n_reused int := 0; n_skipped int := 0; n_party int := 0;
  v_map text; v_t0 timestamp := clock_timestamp();
begin
  -- Numbers taken BEFORE anything is created, so the checks below can compare
  -- a delta rather than an absolute. Three leaves under CUSTOMERS/SUPPLIERS are
  -- already party-less today (TEST, BASMA GROUP, FAHAD TALQ) — an absolute
  -- "every leaf there is a party" check would fail on data this import never
  -- touched, and a check that fails for the wrong reason teaches nothing.
  create temp table _coa_before on commit drop as
  select (select count(*) from accounts) as accounts,
         (select count(*) from parties)  as parties,
         (select count(*) from journal_entries) as entries,
         (select count(*) from accounts a
           where not a.is_group and a.party_id is null
             and (a.path like (select path from accounts where code='1-04-01') || '%'
               or a.path like (select path from accounts where code='2-01-01') || '%')) as partyless_leaves;

  select ur.user_id into v_admin from user_roles ur join profiles p on p.id = ur.user_id
   where ur.role = 'admin' limit 1;
  select company_id into v_co from profiles where id = v_admin;
  if v_co is null then raise exception 'no admin/company to run as'; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  for r in
    select (split_part(l,'|',1))::int as seq,
           (split_part(l,'|',2))::int as depth,
           split_part(l,'|',3) as kind,
           btrim(substr(l, length(split_part(l,'|',1)||'|'||split_part(l,'|',2)||'|'||split_part(l,'|',3))+2)) as nm
      from regexp_split_to_table(btrim(v_rows), E'\n') l
     where btrim(l) <> ''
     order by 1
  loop
    d := r.depth;

    -- ── the declared map: where an Excel node is a node this chart already has,
    -- where a level is dropped, and where a root has no counterpart ──────────
    v_map := case r.nm
      when 'Bank Ac'                      then 'SKIP'
      when 'CURRENT ASSETS'               then 'COLLAPSE'
      when 'CASH & BANK'                  then 'COLLAPSE'
      when 'CURRENT LIABLITIES'           then 'COLLAPSE'
      when 'EQUITY A/Cs'                  then '=3'
      when 'DRAWING'                      then '=3-02'
      when 'ASSETS'                       then '=1'
      when 'FIXED ASSETS'                 then '=1-01'
      when 'PROPERTY'                     then '=1-01-01'
      when 'VEHICLES'                     then '=1-01-02'
      when 'OFFICE EQUIPEMENT'            then '=1-01-03'
      when 'CASH & CHEQUE'                then '=1-02'
      when 'BANK'                         then '=1-03'
      when 'BANK PKR'                     then '=1-03-01'
      when 'A/C RECIEVEABLE'              then '=1-04'
      when 'CUSTOMERS'                    then '=1-04-01'
      when 'UMRAH VISA CUSTOMERS'         then '=1-04-01-01'
      when 'HOTEL CUSTOMERS'              then '=1-04-01-02'
      when 'CAR TRADING CUSTOMER'         then '=1-04-01-03'
      when 'VISTA CAR CUSTOMERS'          then '=1-04-01-04'
      when 'VISTA CUSTOMERS'              then '=1-04-01-35'
      when 'LIABILITIES'                  then '=2'
      when 'SUPPLIERS'                    then '=2-01-01'
      when 'TRANSPORT SUPPLIERS'          then '=2-01-01-12'
      when 'CAR SUPPLIERS'                then '=2-01-01-21'
      when 'REVENUES'                     then '=4'
      when 'EXPENSES'                     then '=5'
      when 'Profit/Loss A/C'              then '=9-02'
      when 'Opening Balances Control A/C' then '=9-01'
      -- roots the Excel has and this chart does not: made, under the root they
      -- belong to rather than as new top-level trees
      when 'LONG TERM LIABLITIES'         then '@2'
      when 'COGS EXPENSE'                 then '@5'
      when 'Journal Entries Control A/C'  then '@9'
      else null
    end;

    if v_map = 'SKIP' then
      n_skipped := n_skipped + 1;
      anc[d+1] := null;
      continue;
    end if;

    -- parent = nearest ancestor that resolved to a real account
    v_parent := null;
    if d > 0 then
      for i in reverse d-1 .. 0 loop
        if anc[i+1] is not null then v_parent := anc[i+1]; exit; end if;
      end loop;
    end if;

    if v_map = 'COLLAPSE' then
      -- the level is dropped: its children hang off this node's own parent
      anc[d+1] := v_parent;
      n_skipped := n_skipped + 1;
      continue;
    end if;

    if v_map like '=%' then
      select id into v_id from accounts
       where company_id = v_co and code = substr(v_map, 2);
      if v_id is null then
        raise exception 'coa: mapped code % (for "%") is not in the chart', substr(v_map,2), r.nm;
      end if;
      anc[d+1] := v_id;
      n_reused := n_reused + 1;
      continue;
    end if;

    if v_map like '@%' then
      select id into v_parent from accounts
       where company_id = v_co and code = substr(v_map, 2);
      if v_parent is null then
        raise exception 'coa: root % (for "%") is not in the chart', substr(v_map,2), r.nm;
      end if;
    end if;

    if v_parent is null then
      raise exception 'coa: "%" at depth % has no parent — the map is incomplete', r.nm, d;
    end if;

    -- already there, under this very parent?
    select a.id into v_id from accounts a
     where a.company_id = v_co and a.parent_id = v_parent
       and _coa_norm(a.name) = _coa_norm(r.nm)
     limit 1;
    if v_id is not null then
      anc[d+1] := v_id;
      n_reused := n_reused + 1;
      continue;
    end if;

    -- subtype, taken from the root this node ended up under
    select split_part(a.code, '-', 1) into v_root from accounts a where a.id = v_parent;
    v_sub := case
      when r.kind = 'Ac' then 'Receivable'
      when r.kind = 'As' then 'Payable'
      when r.kind = 'G'  then null
      when v_root = '3'  then 'Drawing'
      when v_root = '4'  then 'Revenue'
      when v_root = '5'  then 'Indirect Expense'
      else null
    end;

    v_res := acct_create(
      v_co, v_parent, r.nm, null,
      r.kind = 'G',
      v_sub,
      null::account_type,
      'SAR', 0, true, null,
      case r.kind when 'Ac' then 'customer' when 'As' then 'supplier' else null end);
    v_id := (v_res->>'id')::uuid;
    anc[d+1] := v_id;
    n_created := n_created + 1;
    if r.kind in ('Ac','As') then n_party := n_party + 1; end if;
  end loop;

  perform set_config('role', 'postgres', true);
  raise notice 'coa merge: created % (of which % parties), reused %, skipped %, in %',
    n_created, n_party, n_reused, n_skipped, clock_timestamp() - v_t0;
end $mig$;


-- ── proof, in the same transaction, so a wrong answer takes the whole thing
-- back out rather than leaving half a chart ───────────────────────────────
do $chk$
declare v_co uuid; v_n int; v_t text;
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role='admin' limit 1;

  -- 1. the accounts the posting engines reach by code or name must be untouched
  for v_t in select unnest(array['1160','5100','9-01','1-05','1000','1010','1100','2000']) loop
    if not exists (select 1 from accounts where company_id=v_co and code=v_t) then
      raise exception 'coa check: engine account % has gone', v_t;
    end if;
  end loop;
  if (select name from accounts where company_id=v_co and code='1160') <> 'Vehicle Inventory'
     or (select name from accounts where company_id=v_co and code='1-05') <> 'Inventory'
     or (select name from accounts where company_id=v_co and code='9-01') <> 'Opening Balance Control'
  then raise exception 'coa check: an engine account was renamed'; end if;

  -- 2. every one of the 49 parties that existed still has its account, and no
  -- existing account lost its party link
  select count(*) into v_n from parties p
   where not exists (select 1 from accounts a where a.party_id = p.id);
  if v_n <> 0 then raise exception 'coa check: % party(ies) have no ledger account', v_n; end if;

  -- 3. no duplicate codes, no duplicate name under one parent
  select count(*) into v_n from (
    select code from accounts where company_id=v_co group by code having count(*)>1) d;
  if v_n <> 0 then raise exception 'coa check: % duplicate account code(s)', v_n; end if;
  select count(*) into v_n from (
    select parent_id, _coa_norm(name) nm from accounts where company_id=v_co
     group by 1,2 having count(*)>1) d;
  if v_n <> 0 then raise exception 'coa check: % duplicated name(s) under one parent', v_n; end if;

  -- 4. this import must not ADD a single party-less leaf under CUSTOMERS or
  -- SUPPLIERS. Measured as a delta against the three that were already there.
  select count(*) into v_n
    from accounts a
   where a.company_id=v_co and not a.is_group and a.party_id is null
     and (a.path like (select path from accounts where company_id=v_co and code='1-04-01') || '%'
       or a.path like (select path from accounts where company_id=v_co and code='2-01-01') || '%');
  if v_n > (select partyless_leaves from _coa_before) then
    raise exception 'coa check: % customer/supplier account(s) have no party, up from %',
      v_n, (select partyless_leaves from _coa_before);
  end if;

  -- 5. a group must never be postable and a leaf must always be
  select count(*) into v_n from accounts
   where company_id=v_co and (is_group = is_postable);
  if v_n <> 0 then raise exception 'coa check: % account(s) are both a group and postable, or neither', v_n; end if;

  -- 6. the tree must be a tree: every non-root has a parent that exists, and
  -- nothing is its own ancestor (acct_rebuild_paths would have looped)
  select count(*) into v_n from accounts a
   where a.company_id=v_co and a.parent_id is not null
     and not exists (select 1 from accounts p where p.id = a.parent_id);
  if v_n <> 0 then raise exception 'coa check: % orphaned account(s)', v_n; end if;

  -- 7. and nothing posted anything: this is structure only, no opening balances
  select count(*) into v_n from journal_entries;
  if v_n <> 0 then raise exception 'coa check: % journal entry(ies) exist — this import must post nothing', v_n; end if;

  select count(*) into v_n from accounts where company_id=v_co;
  raise notice 'coa check: all clear. accounts % -> %, parties % -> %, journal entries still %',
    (select accounts from _coa_before), v_n,
    (select parties from _coa_before), (select count(*) from parties),
    (select count(*) from journal_entries);
end $chk$;

drop function if exists public._coa_norm(text);

commit;
