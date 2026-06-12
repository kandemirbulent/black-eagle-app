(() => {
  const STORAGE_KEY = "preferredLanguage";
  const DEFAULT_LANGUAGE = "en";
  const SUPPORTED_LANGUAGES = new Set(["en", "tr"]);

  const translations = {
    tr: {
      "common.lang.english": "English",
      "common.lang.turkish": "Türkçe",

      "index.title": "Black Eagle Agency | Londra ve Birleşik Krallık Genelinde Etkinlik Personeli",
      "index.description": "Black Eagle Agency, etkinlik müşterilerini Londra ve Birleşik Krallık genelinde düğünler, özel etkinlikler ve kurumsal hizmetler için onaylı hospitality personeliyle buluşturur.",
      "index.brandSubtitle": "Hospitality Personel Ajansı",
      "index.nav.services": "Hizmetler",
      "index.nav.showcase": "Görsel Vitrin",
      "index.nav.howItWorks": "Nasıl Çalışır",
      "index.nav.platform": "Platform",
      "index.nav.standards": "Standartlar",
      "index.nav.terms": "Şartlar",
      "index.nav.login": "Müşteri ve Personel Girişi",
      "index.hero.eyebrow": "Ana Sayfa Slider",
      "index.hero.title": "Temiz, dönen bir afişte gösterilen etkinlik ekipleri.",
      "index.hero.copy": "Ana sayfanın üst kısmı artık yüklenen görselleri daha ince bir slider olarak kullanıyor. Daha dikdörtgen, daha az baskın ve yine de sayfanın ilk izlenimini daha güçlü hale getiriyor.",
      "index.hero.hireStaff": "Personel Kirala",
      "index.hero.joinTeam": "Ekibimize Katıl",
      "index.hero.badge.bartenders": "Barmenler",
      "index.hero.badge.waiters": "Garsonlar",
      "index.hero.badge.chefs": "Şefler",
      "index.hero.badge.security": "Güvenlik",
      "index.hero.panelKicker": "Görsel Slider",
      "index.hero.panelTitle": "İnce dikdörtgen, tam genişlik değil.",
      "index.hero.panelCopy": "Bu slider artık sayfa konteyneri içinde yer alıyor; böylece ekranın tamamına yayılmak yerine daha temiz ve kontrollü hissediliyor.",
      "index.slider.prev": "Önceki başlık slaytı",
      "index.slider.next": "Sonraki başlık slaytı",
      "index.slider.aria": "Ana sayfa başlık slaytları",
      "index.services.tag": "Hizmetler",
      "index.services.title": "Yoğun etkinlik günleri için hospitality desteği",
      "index.services.copy": "Platform, sıradan bir rezervasyon formu etrafında değil gerçek personel operasyonları etrafında tasarlandı. Zamanlama, sunum ve hesap verebilirliğin etkinliği doğrudan etkilediği yerde bu fark önemlidir.",
      "index.services.card1.title": "Müşteri rezervasyon deneyimi",
      "index.services.card1.copy": "Müşteriler etkinlik talepleri oluşturur, depozito öder, atanan personeli inceler ve hizmeti güvenle onaylar.",
      "index.services.card2.title": "Rol bazlı personel erişimi",
      "index.services.card2.copy": "Adaylar her işi görmez. Profillerine, konumlarına ve uygunluklarına göre doğru rolleri görürler.",
      "index.services.card3.title": "Yönetici kontrollü onaylar",
      "index.services.card3.copy": "Gerçek insanlar başvuruları inceler, uygun kullanıcıları onaylar, riskli olanları reddeder ve kadro kalitesini korur.",
      "index.showcase.tag": "Çalışmalarımız",
      "index.showcase.title": "Canlı etkinlik günlerinde yerleştirdiğimiz ekipleri görün",
      "index.showcase.copy": "Bu alan göstermek istediğiniz işlerin etrafında kuruldu. Hero banner bölümü görsel tutar, ana kartlar en güçlü rolleri öne çıkarır ve diğer işler aşağıda daha temiz yatay bir düzende kalır.",
      "index.showcase.bannerTag": "Ekip Vitrini",
      "index.showcase.bannerTitle": "Farklı iş grupları, tek güçlü görsel ön yüz",
      "index.showcase.bannerCopy": "Bu bölümün üst kısmı artık görsel bir başlık gibi çalışıyor. Daha sonra özel bir kalabalık veya karma ekip başlık görseli gönderirsen, yerleşimi değiştirmeden bu kolajı tek büyük banner ile değiştirebiliriz.",
      "index.showcase.bannerNote1": "Bar ekipleri",
      "index.showcase.bannerNote2": "Ön saha personeli",
      "index.showcase.bannerNote3": "Mutfak desteği",
      "index.showcase.bannerNote4": "Aşağıda daha fazla rol",
      "index.showcase.card1.label": "Bar Hizmeti",
      "index.showcase.card1.title": "Barmenler",
      "index.showcase.card2.label": "Ön Saha",
      "index.showcase.card2.title": "Garsonlar",
      "index.showcase.card3.label": "Mutfak Ekibi",
      "index.showcase.card3.title": "Şefler",
      "index.showcase.detail1.tag": "Bar Hizmeti",
      "index.showcase.detail1.title": "Şık ve hızlı içecek servisi",
      "index.showcase.detail1.copy": "Bu galeri öğesi, Black Eagle’ın düğünler, özel davetler ve hem hızın hem sunumun önemli olduğu premium hospitality anları için sağlayabildiği bar ekibi türünü gösterir.",
      "index.showcase.detail1.note1": "Karşılama içecekleri ve kokteyl desteği",
      "index.showcase.detail1.note2": "Yoğun servis anlarında bar desteği",
      "index.showcase.detail1.note3": "Tezgâh arkasında profesyonel sunum",
      "index.showcase.detail2.tag": "Servis Personeli",
      "index.showcase.detail2.title": "Salonun sakin ve düzenli hissettirmesine yardımcı olan ekipler",
      "index.showcase.detail2.copy": "Bu kart ön saha servis işleri içindir. Etkinlik personelinin misafirlere servis yaptığı, masaları yönettiği ve salon genelinde düzenli bir standart sürdürdüğü görselleri göstermek için doğru yerdir.",
      "index.showcase.detail2.note1": "Misafir karşılama ve masa desteği",
      "index.showcase.detail2.note2": "Canlı servis boyunca güvenilir tempo",
      "index.showcase.detail2.note3": "Özel etkinliklerde profesyonel duruş",
      "index.showcase.detail3.tag": "Şef Desteği",
      "index.showcase.detail3.title": "Arka plandaki operasyonu ilerleten mutfak uzmanları",
      "index.showcase.detail3.copy": "Bu alan, etkinliği perde arkasından destekleyen şef ve mutfak rollerini öne çıkarır. Yemek hazırlığı, servis koordinasyonu ve operasyonun baskı yönetimi tarafını göstermek için uygundur.",
      "index.showcase.detail3.note1": "Servis sırasında hazırlık ve pass desteği",
      "index.showcase.detail3.note2": "Daha güçlü arka saha koordinasyonu",
      "index.showcase.detail3.note3": "Etkinlik günleri için deneyimli mutfak desteği",
      "index.showcase.rolesTag": "Daha Fazla Rol",
      "index.showcase.rolesTitle": "Diğer işleri kompakt ve yatay tut",
      "index.showcase.rolesCopy": "Bu roller sayfanın fazla kalabalıklaşmaması için daha ince bir biçimde kalır. Security, Cleaning ve Barback sonraki adımda daha büyük görsel bloklara taşınabilir.",
      "index.showcase.featuredTag": "Öne Çıkan Dikey Roller",
      "index.showcase.featuredTitle": "Security artık daha büyük görsel formatta yer alabilir",
      "index.showcase.featuredCopy": "Bu üst üste yerleşim, daha görsel kalması gereken roller için ayrıldı. Sonraki aşamada aynı blok stiline Cleaning ve Barback de eklenebilir.",
      "index.showcase.featuredCard.title": "Profesyonel misafir kontrolü ve sakin giriş noktası yönetimi",
      "index.showcase.featuredCard.copy": "Bu yerleşim artık daha görsel roller için hazır. Security burada premium bir öne çıkan blok olarak gösteriliyor; böylece sayfa temiz kalırken önemli hizmetler daha güçlü görünürlük kazanıyor.",
      "index.showcase.featuredCard.note1": "Misafir kontrolü ve erişim yönetimi",
      "index.showcase.featuredCard.note2": "Etkinlik girişinde profesyonel duruş",
      "index.showcase.featuredCard.note3": "Daha büyük öne çıkan görseller için uygun format",
      "index.roles.group.hospitality": "Hospitality",
      "index.roles.group.featuredNext": "Sıradaki Öne Çıkan",
      "index.roles.group.eventCrew": "Etkinlik Ekibi",
      "index.roles.group.cleaning": "Temizlik",
      "index.roles.group.trade": "Teknik İşler",
      "index.roles.group.security": "Güvenlik",
      "index.roles.group.support": "Destek",
      "index.roles.kitchenPorter": "Mutfak Destek Personeli",
      "index.roles.barback": "Barback",
      "index.roles.eventStaff": "Etkinlik Personeli",
      "index.roles.houseCleaning": "Ev Temizliği",
      "index.roles.officeCleaning": "Ofis Temizliği",
      "index.roles.deepCleaning": "Detaylı Temizlik",
      "index.roles.windowCleaner": "Cam Temizliği",
      "index.roles.constructionWorker": "İnşaat İşçisi",
      "index.roles.electrician": "Elektrikçi",
      "index.roles.plumber": "Tesisatçı",
      "index.roles.painter": "Boyacı",
      "index.roles.handyman": "Tamir Ustası",
      "index.roles.doorSupervisor": "Kapı Görevlisi",
      "index.roles.deliveryDriver": "Teslimat Sürücüsü",
      "index.roles.warehouseStaff": "Depo Personeli",
      "index.how.tag": "Nasıl Çalışır",
      "index.how.title": "Etkinlik talebinden onaylı ekibe daha temiz bir yol",
      "index.how.step1.title": "Başvur ve doğrulan",
      "index.how.step1.copy": "Müşteriler ve personel kayıt bilgilerini gönderir. Yönetici incelemesi, erişim verilmeden önce sistemi güvenilir tutar.",
      "index.how.step2.title": "Etkinliği oluştur",
      "index.how.step2.copy": "Müşteriler personel ihtiyaçlarını gönderir ve depozitoyu tamamlar; böylece talep gerçek, canlı bir rezervasyona dönüşür.",
      "index.how.step3.title": "Doğru başvuruları topla",
      "index.how.step3.copy": "Uygun personel başvurur, başvuru penceresi kapanır ve mevcut en güçlü ekip seçilebilir.",
      "index.how.step4.title": "Onayla, teslim et ve değerlendir",
      "index.how.step4.copy": "Müşteriler etkinlikte onaylanan personeli görür, hizmet sunulur ve geri bildirim kalite döngüsünü kapatır.",
      "index.platform.tag": "Platform Erişimi",
      "index.platform.title": "Tek marka, iki kullanıcı yolculuğu, tek kontrollü operasyon",
      "index.platform.clients.title": "Müşteriler için",
      "index.platform.clients.copy": "Etkinlik oluşturun, ödemeleri takip edin, onaylanan personeli inceleyin ve iş tamamlandıktan sonra geri bildirim bırakın. Müşteri deneyimi etkinlik gününden önce belirsizliği azaltmak için tasarlandı.",
      "index.platform.clients.item1": "İnceleme sonrası yalnızca onaylı erişim",
      "index.platform.clients.item2": "Depozito ve son ödeme görünürlüğü",
      "index.platform.clients.item3": "Etkinlik kaydı içinde görünen onaylı personel",
      "index.platform.staff.title": "Personel için",
      "index.platform.staff.copy": "Personel doğrulanmış hesaplar oluşturur, ödeme bilgilerini tamamlar, uygun işlere başvurur ve alakasız ilanlarla boğulmadan atamalarını takip eder.",
      "index.platform.staff.item1": "E-posta doğrulama ve yönetici onay akışı",
      "index.platform.staff.item2": "Rol ve konuma göre etkinlik görünürlüğü",
      "index.platform.staff.item3": "Seçim sonrası atama ve kazanç görünürlüğü",
      "index.standards.tag": "Standartlar",
      "index.standards.title": "Kaotik değil, güven veren hissettirmek için tasarlandı",
      "index.standards.copy": "Açık site, hizmetin verdiği mesajı iletmeli: ilk talepten son ödemeye kadar kontrol, güvenilirlik ve premium operasyon standardı.",
      "index.standards.card1.title": "Doğrulanmış erişim",
      "index.standards.card1.copy": "Bekleyen onaylar ve manuel inceleme; müşterileri, personeli ve işletmeyi düşük kaliteli kayıtlar karşısında korumaya yardımcı olur.",
      "index.standards.card2.title": "Kadro görünürlüğü",
      "index.standards.card2.copy": "Müşteriler onaylanan personel listesini etkinlikle eşleştirebilir; bu da hizmet günündeki belirsizliği azaltır.",
      "index.standards.card3.title": "Operasyonel takip",
      "index.standards.card3.copy": "Geri bildirim, ödeme aşamaları ve rol takibi; tek seferlik rezervasyonları yönetilebilir bir işletim sistemine dönüştürür.",
      "index.cta.title": "Personel rezervasyonu yapmaya veya kadroya katılmaya hazır mısınız?",
      "index.cta.copy": "Hesap oluşturmak, başvurunuzu göndermek veya panelinize devam etmek için canlı platformu kullanın.",
      "index.cta.client": "Müşteri Hesabı Oluştur",
      "index.cta.staff": "Personel Hesabı Oluştur",
      "index.cta.login": "Giriş Yap",
      "index.footer.copy": "Black Eagle Agency. Londra ve Birleşik Krallık genelinde etkinlikler için hospitality personeli.",
      "index.footer.about": "Hakkında",
      "index.footer.contact": "İletişim",
      "index.footer.privacy": "Gizlilik",
      "index.footer.terms": "Şartlar",

      "about.title": "Black Eagle Hakkında | Etkinlikler İçin Hospitality Personeli",
      "about.description": "Black Eagle’ın etkinlik müşterilerini, hospitality personelini ve operasyon ekiplerini tek kontrollü personel platformu üzerinden nasıl desteklediğini öğrenin.",
      "about.brandSubtitle": "Ajans hakkında",
      "about.nav.home": "Ana Sayfa",
      "about.nav.contact": "İletişim",
      "about.nav.privacy": "Gizlilik",
      "about.nav.login": "Giriş",
      "about.hero.eyebrow": "Black Eagle Hakkında",
      "about.hero.title": "Etkinlik personeline sakin, güvenilir bir düzen getirmek için kuruldu.",
      "about.hero.copy": "Black Eagle, dahil olan herkes için hospitality personel sürecini daha kontrollü hissettirmek için var: hizmet rezervasyonu yapan müşteriler, iş başvurusu yapan personel ve kalite, onaylar ve teslimattan sorumlu iç ekip.",
      "about.note.title": "Platformun çözmek için tasarlandığı şey",
      "about.note.copy": "Daha az karmaşa, daha az uygunsuz başvuru, daha net kadro görünürlüğü ve etkinlik günü başlamadan daha güçlü güven.",
      "about.section1.title": "Kime hizmet veriyoruz",
      "about.section1.copy": "Black Eagle, tek birleşik sistem üzerinden iki ana grubu destekler. Müşteriler düğünler, özel davetler ve hospitality odaklı etkinlikler için güvenilir personele ihtiyaç duyar. Personel ise alakasız iş ilanları ve belirsiz iletişim yerine uygun işe ulaşabilecek güvenilir bir yola ihtiyaç duyar.",
      "about.section2.title": "Hizmet nasıl çalışır",
      "about.section2.copy": "Hem müşteri hem personel erişimi başvuru ve onay adımıyla başlar. Bu, platformu açık bir pazaryerine göre daha güvenilir kılar. Onaydan sonra müşteriler etkinlik oluşturabilir, depozito ve bakiye ödemelerini takip edebilir, rezervasyonlarına atanan onaylı ekibi inceleyebilir. Personel profilini tamamlayabilir, gelecekteki ödemeler için gerekli bilgileri verebilir ve sadece uygun fırsatlara başvurabilir.",
      "about.section3.title": "Operasyonel olarak neden önemli",
      "about.section3.copy": "Etkinlik personel süreci, erişim çok açıksa, kadrolar belirsizse veya doğru kişiler doğru işle eşleştirilemiyorsa hızla bozulur. Black Eagle, sadece bir tanıtım sitesi değil operasyonel bir platform olarak inşa ediliyor; böylece ajans başvuruları onaylayabilir, personel kalitesini kontrol edebilir ve müşterilere gününde kimin geleceği konusunda güven verebilir.",
      "about.section4.title": "Hedefimiz ne",
      "about.section4.copy": "Hedef basit: premium, güvenilir ve iyi yönetilen bir hizmet. Bu da açık sitenin, platform deneyiminin ve operasyonel iş akışının aynı mesajı vermesi gerektiği anlamına gelir: Black Eagle etkinlik personel işini ciddiye alır.",
      "about.aside.title": "Hızlı bağlantılar",
      "about.aside.bookTitle": "Personel rezerve edin",
      "about.aside.bookCopy": "<a href=\"/Customer-logins/customer-login-create.html\">Müşteri hesabı oluşturun</a> ve talebinizi gönderin.",
      "about.aside.joinTitle": "Kadroya katılın",
      "about.aside.joinCopy": "Onay sürecine başlamak için <a href=\"/staff-logins/staff-login-create.html\">personel hesabı oluşturun</a>.",
      "about.aside.termsTitle": "Şartlarımızı okuyun",
      "about.aside.termsCopy": "<a href=\"/terms.html\">Şartlar ve Koşullar</a>, rezervasyon, iptal ve ödeme beklentilerini açıklar.",
      "about.footer.copy": "Black Eagle Agency. Londra ve Birleşik Krallık genelinde etkinlikler için hospitality personeli.",

      "contact.title": "Black Eagle ile İletişim | Etkinlik Personel Talepleri",
      "contact.description": "Etkinlik personel talepleri, hesap desteği ve genel ajans soruları için Black Eagle ile iletişime geçin.",
      "contact.brandSubtitle": "İletişim",
      "contact.hero.eyebrow": "Bize ulaşın",
      "contact.hero.title": "Personel, destek veya hesabınız hakkında Black Eagle ile konuşun.",
      "contact.hero.copy": "Talebinizin işletmenin doğru bölümüne hızla ulaşması için aşağıdaki ilgili yolu kullanın. Bu, daha hızlı yanıt vermemize yardımcı olur ve hizmet taleplerini platform desteğinden ayırır.",
      "contact.note.title": "Aktif kullanıcılar için en iyi yol",
      "contact.note.copy": "Zaten onaylı bir hesabınız varsa, rezervasyonunuz veya başvurunuzla ilgili sürece devam etmek için paneliniz en iyi yerdir.",
      "contact.options.title": "İletişim seçenekleri",
      "contact.options.general": "Genel sorular",
      "contact.options.location": "İşletme konumu",
      "contact.options.locationCopy": "Londra, Birleşik Krallık",
      "contact.options.client": "Yeni müşteri rezervasyonları",
      "contact.options.clientCopy": "Platform üzerinden etkinlik personeli talep etmek istiyorsanız müşteri kayıt yolunu kullanın.",
      "contact.options.staff": "Personel başvuruları",
      "contact.options.staffCopy": "Canlı fırsatlara ilgi göstermek için personel kayıt yolunu kullanın.",
      "contact.before.title": "Bize ulaşmadan önce",
      "contact.before.li1": "Onay bekliyorsanız, başvuruda kullandığınız e-posta adresini kontrol edin.",
      "contact.before.li2": "Mevcut bir müşteriyseniz, rezervasyon veya sipariş bilgilerinizi hazır bulundurun.",
      "contact.before.li3": "Onaylı bir personelseniz, ekibin kaydınızı hızlıca bulabilmesi için hesap e-postanızı hazır tutun.",
      "contact.routes.title": "Yararlı yollar",
      "contact.routes.copy": "Platform işlemlerinin çoğu genel bir talep yerine onaylı hesap akışı içinde yapılmak üzere tasarlanmıştır. Devam etmeye hazırsanız aşağıdaki doğru yolu kullanın.",
      "contact.routes.client": "Müşteri hesabı",
      "contact.routes.staff": "Personel hesabı",
      "contact.routes.login": "Mevcut giriş",
      "contact.support.title": "Destek notları",
      "contact.support.clientTitle": "Müşteri desteği",
      "contact.support.clientCopy": "Rezervasyon soruları, etkinlik değişiklikleri, ödeme takibi ve kadro görünürlüğü.",
      "contact.support.staffTitle": "Personel desteği",
      "contact.support.staffCopy": "Başvuru durumu, onboarding, profil tamamlama ve atama soruları.",
      "contact.support.policyTitle": "Politika belgeleri",
      "contact.support.policyCopy": "<a href=\"/privacy.html\">Gizlilik Politikası</a>, <a href=\"/account-deletion.html\">Hesap Silme</a> ve <a href=\"/terms.html\">Şartlar ve Koşullar</a>.",
      "contact.footer.copy": "Black Eagle Agency. Londra ve Birleşik Krallık genelinde etkinlikler için hospitality personeli.",
      "contact.footer.accountDeletion": "Hesap silme",

      "privacy.title": "Gizlilik Politikası | Black Eagle Services",
      "privacy.description": "Müşteri hesapları, personel onboarding verileri, ödemeler, iletişimler ve hesap silme taleplerini kapsayan Black Eagle Services gizlilik politikasını okuyun.",
      "privacy.brandSubtitle": "Gizlilik Politikası",
      "privacy.hero.eyebrow": "Gizlilik ve veri kullanımı",
      "privacy.hero.title": "Black Eagle Services kişisel verileri nasıl toplar, kullanır ve korur.",
      "privacy.hero.copy": "Bu Gizlilik Politikası, Black Eagle web sitesi, platform panelleri, hesap onboarding akışları ve aynı hizmetlere bağlanan her türlü mobil uygulama veya webview için geçerlidir.",
      "privacy.note.title": "Son güncelleme",
      "privacy.note.copy": "23 Nisan 2026",
      "privacy.summary.title": "Hızlı özet",
      "privacy.summary.mainUses": "Ana kullanımlar",
      "privacy.summary.mainUsesCopy": "Hesap yönetimi, etkinlik personeli, rezervasyon teslimi, ödemeler, destek ve güvenlik.",
      "privacy.summary.sensitive": "Hassas kategoriler",
      "privacy.summary.sensitiveCopy": "Personel selfie görselleri, Ulusal Sigorta bilgileri ve banka detayları sadece onboarding ve operasyonlar için gerektiğinde kullanılır.",
      "privacy.summary.thirdParties": "Üçüncü taraflar",
      "privacy.summary.thirdPartiesCopy": "Ödemeler Stripe tarafından işlenebilir. Hizmet e-postaları yapılandırılmış e-posta sağlayıcılarımız üzerinden gönderilebilir.",
      "privacy.summary.deletion": "Silme talepleri",
      "privacy.summary.deletionCopy": "<a href=\"/account-deletion.html\">Hesap silme sayfasını açın</a> ve hesap kaldırma veya veri silme incelemesi talep edin.",
      "privacy.summary.contact": "İletişim",
      "privacy.footer.copy": "Black Eagle Services. Londra ve Birleşik Krallık genelinde etkinlikler için hospitality personeli.",
      "privacy.footer.accountDeletion": "Hesap silme",

      "terms.title": "Şartlar ve Koşullar | Black Eagle Agency",
      "terms.description": "Rezervasyonlar, depozitolar, iptaller, personel değişiklikleri ve operasyonel beklentileri kapsayan Black Eagle Agency şartları ve koşulları.",
      "terms.brandSubtitle": "Şartlar ve Koşullar",
      "terms.hero.eyebrow": "Rezervasyon şartları",
      "terms.hero.title": "Müşteriler, personel ve ajans operasyonları için net rezervasyon kuralları.",
      "terms.hero.copy": "Bu şartlar, Black Eagle’ın rezervasyonları, depozitoları, iptalleri, ödeme aşamalarını, hizmet teslim beklentilerini ve platform genelindeki operasyonel korumaları nasıl yönettiğini açıklar.",
      "terms.note.title": "Yayın öncesi",
      "terms.note.copy": "Bu belge, kamuya açık yayın öncesinde nihai canlı işletme bilgileriniz, iptal politikanız ve hukuki metinlerinizle birlikte gözden geçirilmelidir.",
      "terms.related.title": "İlgili sayfalar",
      "terms.related.privacyTitle": "Gizlilik politikası",
      "terms.related.privacyCopy": "<a href=\"/privacy.html\">Verilerin nasıl işlendiğini okuyun</a>.",
      "terms.related.clientTitle": "Müşteri kaydı",
      "terms.related.clientCopy": "<a href=\"/Customer-logins/customer-login-create.html\">Bir müşteri başvurusu başlatın</a>.",
      "terms.related.staffTitle": "Personel kaydı",
      "terms.related.staffCopy": "<a href=\"/staff-logins/staff-login-create.html\">Bir personel başvurusu başlatın</a>.",
      "terms.footer.copy": "Black Eagle Agency. Londra ve Birleşik Krallık genelinde etkinlikler için hospitality personeli.",

      "deletion.title": "Hesap Silme | Black Eagle Services",
      "deletion.description": "Black Eagle müşteri veya personel hesabınızın silinmesini nasıl talep edeceğinizi ve hukuki ya da operasyonel nedenlerle hangi verilerin tutulabileceğini öğrenin.",
      "deletion.brandSubtitle": "Hesap Silme",
      "deletion.hero.eyebrow": "Hesabınızı silin",
      "deletion.hero.title": "Black Eagle hesabınızın silinmesini nasıl talep edersiniz.",
      "deletion.hero.copy": "Müşteriler ve personel, aşağıdaki adımları kullanarak Black Eagle Services ile iletişime geçip hesap silme veya kişisel veri incelemesi talep edebilir.",
      "deletion.note.title": "Silme iletişimi",
      "deletion.note.copy": "<a href=\"mailto:info@blackeagleservices.co.uk\">info@blackeagleservices.co.uk</a>",
      "deletion.summary.title": "Hızlı özet",
      "deletion.summary.channelTitle": "Talep kanalı",
      "deletion.summary.channelCopy": "Kayıtlı hesap e-postanızdan <a href=\"mailto:info@blackeagleservices.co.uk\">info@blackeagleservices.co.uk</a> adresine e-posta gönderin.",
      "deletion.summary.whoTitle": "Kim talep edebilir",
      "deletion.summary.whoCopy": "Hem personel hem müşteri hesap sahipleri.",
      "deletion.summary.retentionTitle": "Saklama istisnaları",
      "deletion.summary.retentionCopy": "Bazı hukuki, ödeme ve uyumluluk kayıtları hesap silinse bile tutulabilir.",
      "deletion.footer.copy": "Black Eagle Services. Londra ve Birleşik Krallık genelinde etkinlikler için hospitality personeli.",
      "deletion.footer.accountDeletion": "Hesap silme"
    }
  };

  const getLanguage = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.has(stored) ? stored : DEFAULT_LANGUAGE;
  };

  const setLanguage = (language) => {
    const nextLanguage = SUPPORTED_LANGUAGES.has(language) ? language : DEFAULT_LANGUAGE;
    localStorage.setItem(STORAGE_KEY, nextLanguage);
    applyLanguage(nextLanguage);
  };

  const translate = (key, language) => {
    if (language === DEFAULT_LANGUAGE) return null;
    return translations[language]?.[key] ?? null;
  };

  const applyLanguage = (language) => {
    document.documentElement.lang = language;

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n;
      const translated = translate(key, language);
      if (translated !== null) {
        element.textContent = translated;
      } else if (element.dataset.i18nDefault) {
        element.textContent = element.dataset.i18nDefault;
      }
    });

    document.querySelectorAll("[data-i18n-html]").forEach((element) => {
      const key = element.dataset.i18nHtml;
      const translated = translate(key, language);
      if (translated !== null) {
        element.innerHTML = translated;
      } else if (element.dataset.i18nDefaultHtml) {
        element.innerHTML = element.dataset.i18nDefaultHtml;
      }
    });

    document.querySelectorAll("[data-i18n-content]").forEach((element) => {
      const key = element.dataset.i18nContent;
      const translated = translate(key, language);
      const defaultValue = element.dataset.i18nDefaultContent;
      if (translated !== null) {
        element.setAttribute("content", translated);
      } else if (defaultValue) {
        element.setAttribute("content", defaultValue);
      }
    });

    document.querySelectorAll("[data-i18n-title]").forEach((element) => {
      const key = element.dataset.i18nTitle;
      const translated = translate(key, language);
      if (translated !== null) {
        element.textContent = translated;
      } else if (element.dataset.i18nDefaultTitle) {
        element.textContent = element.dataset.i18nDefaultTitle;
      }
    });

    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      const key = element.dataset.i18nAriaLabel;
      const translated = translate(key, language);
      const defaultValue = element.dataset.i18nDefaultAriaLabel;
      if (translated !== null) {
        element.setAttribute("aria-label", translated);
      } else if (defaultValue) {
        element.setAttribute("aria-label", defaultValue);
      }
    });

    document.querySelectorAll("[data-language-option]").forEach((button) => {
      const isActive = button.dataset.languageOption === language;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-language-option]").forEach((button) => {
      button.addEventListener("click", () => setLanguage(button.dataset.languageOption || DEFAULT_LANGUAGE));
    });

    applyLanguage(getLanguage());
  });
})();
