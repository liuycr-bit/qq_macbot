use std::f32::consts::PI;

use skia_safe::{
    Color, FontStyle, Paint, Point, Rect,
    canvas::SrcRectConstraint,
    paint::Style,
    textlayout::TextAlign,
};

use meme_generator_core::error::Error;
use meme_generator_utils::{
    builder::InputImage,
    canvas::CanvasExt,
    encoder::{FrameAlign, GifInfo, encode_png, make_gif_or_combined_gif},
    image::ImageExt,
    text_params,
    tools::{load_image, local_date, new_paint, new_surface},
};

use crate::{options::NoOptions, register_meme};

const WIDTH: i32 = 800;
const HEIGHT: i32 = 800;

fn text_or<'a>(texts: &'a [String], index: usize, fallback: &'a str) -> &'a str {
    texts.get(index).map(String::as_str).filter(|text| !text.trim().is_empty()).unwrap_or(fallback)
}

fn fill_round_rect(canvas: &skia_safe::Canvas, rect: Rect, radius: f32, color: Color) {
    let mut paint = new_paint(color);
    paint.set_anti_alias(true);
    canvas.draw_round_rect(rect, radius, radius, &paint);
}

fn stroke_round_rect(canvas: &skia_safe::Canvas, rect: Rect, radius: f32, color: Color, width: f32) {
    let mut paint = new_paint(color);
    paint.set_anti_alias(true).set_style(Style::Stroke).set_stroke_width(width);
    canvas.draw_round_rect(rect, radius, radius, &paint);
}

fn draw_centered(
    canvas: &skia_safe::Canvas,
    rect: Rect,
    text: &str,
    min_size: f32,
    max_size: f32,
    color: Color,
    bold: bool,
) -> Result<(), Error> {
    canvas.draw_text_area_auto_font_size(
        rect,
        text,
        min_size,
        max_size,
        text_params!(
            paint = new_paint(color),
            font_style = if bold { FontStyle::bold() } else { FontStyle::normal() },
            text_align = TextAlign::Center
        ),
    )
}

fn draw_optional_avatar(canvas: &skia_safe::Canvas, images: &[InputImage], x: i32, y: i32, size: i32) {
    if let Some(input) = images.first() {
        let avatar = input.image.circle().resize_exact((size, size));
        canvas.draw_image(&avatar, (x, y), None);
    }
}

fn finish_card(
    images: Vec<InputImage>,
    title: &str,
    body: &str,
    footer: &str,
    background: Color,
    accent: Color,
    glyph: &str,
) -> Result<Vec<u8>, Error> {
    let mut surface = new_surface((WIDTH, HEIGHT));
    let canvas = surface.canvas();
    canvas.clear(background);
    fill_round_rect(canvas, Rect::from_xywh(42.0, 42.0, 716.0, 716.0), 44.0, Color::WHITE);
    stroke_round_rect(canvas, Rect::from_xywh(42.0, 42.0, 716.0, 716.0), 44.0, accent, 7.0);
    fill_round_rect(canvas, Rect::from_xywh(76.0, 76.0, 648.0, 118.0), 28.0, accent);
    draw_centered(canvas, Rect::from_xywh(98.0, 92.0, 604.0, 86.0), title, 30.0, 55.0, Color::WHITE, true)?;
    draw_centered(canvas, Rect::from_xywh(105.0, 210.0, 590.0, 170.0), glyph, 72.0, 128.0, accent, false)?;
    draw_centered(canvas, Rect::from_xywh(98.0, 385.0, 604.0, 210.0), body, 28.0, 62.0, Color::from_rgb(28, 28, 34), true)?;
    draw_centered(canvas, Rect::from_xywh(105.0, 622.0, 590.0, 75.0), footer, 22.0, 34.0, Color::from_rgb(105, 105, 115), false)?;
    draw_optional_avatar(canvas, &images, 620, 610, 92);
    encode_png(surface.image_snapshot())
}

fn back_hand_opossum(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    let caption = text_or(&texts, 0, "我就看看，不说话");
    let sprite = load_image("back_hand_opossum/spritesheet.webp")?;
    let mut surface = new_surface((800, 720));
    let canvas = surface.canvas();
    canvas.clear(Color::from_rgb(244, 240, 232));
    fill_round_rect(canvas, Rect::from_xywh(35.0, 35.0, 730.0, 650.0), 38.0, Color::WHITE);
    draw_centered(canvas, Rect::from_xywh(70.0, 60.0, 660.0, 90.0), "背手负鼠", 40.0, 68.0, Color::from_rgb(45, 43, 40), true)?;
    let src = Rect::from_xywh(0.0, 0.0, 192.0, 208.0);
    let dst = Rect::from_xywh(215.0, 145.0, 370.0, 400.0);
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    canvas.draw_image_rect(&sprite, Some((&src, SrcRectConstraint::Strict)), dst, &paint);
    draw_centered(canvas, Rect::from_xywh(90.0, 555.0, 620.0, 92.0), caption, 28.0, 54.0, Color::from_rgb(45, 43, 40), true)?;
    draw_optional_avatar(canvas, &images, 635, 565, 76);
    encode_png(surface.image_snapshot())
}

fn sbti_result(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    let code = text_or(&texts, 0, "DEAD");
    let description = text_or(&texts, 1, "精神已死，但还能继续上班");
    let mut surface = new_surface((800, 920));
    let canvas = surface.canvas();
    canvas.clear(Color::from_rgb(18, 20, 24));
    stroke_round_rect(canvas, Rect::from_xywh(45.0, 45.0, 710.0, 830.0), 36.0, Color::from_rgb(126, 232, 181), 6.0);
    draw_centered(canvas, Rect::from_xywh(90.0, 85.0, 620.0, 80.0), "SBTI 人格测试结果", 28.0, 48.0, Color::from_rgb(164, 174, 185), true)?;
    draw_centered(canvas, Rect::from_xywh(75.0, 185.0, 650.0, 245.0), code, 76.0, 170.0, Color::from_rgb(126, 232, 181), true)?;
    fill_round_rect(canvas, Rect::from_xywh(95.0, 460.0, 610.0, 245.0), 30.0, Color::from_rgb(31, 35, 42));
    draw_centered(canvas, Rect::from_xywh(125.0, 490.0, 550.0, 185.0), description, 28.0, 58.0, Color::WHITE, true)?;
    draw_centered(canvas, Rect::from_xywh(100.0, 750.0, 600.0, 70.0), "仅供娱乐，不是心理诊断", 22.0, 32.0, Color::from_rgb(164, 174, 185), false)?;
    draw_optional_avatar(canvas, &images, 628, 744, 82);
    encode_png(surface.image_snapshot())
}

fn niu_lai(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    finish_card(
        images,
        "牛 来",
        text_or(&texts, 0, "牛市来！好运来！"),
        "今日宜：接好运、等牛来",
        Color::from_rgb(255, 236, 171),
        Color::from_rgb(190, 45, 39),
        "🐂",
    )
}

fn hello_eat_some(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    finish_card(
        images,
        "你好，我吃一点",
        text_or(&texts, 0, "看起来很好吃，我就吃一点点"),
        "礼貌伸筷，量力而食",
        Color::from_rgb(235, 246, 255),
        Color::from_rgb(54, 118, 170),
        "🐱 🥢",
    )
}

fn calm_unhurried(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    let ideal = text_or(&texts, 0, "从从容容，游刃有余");
    let reality = text_or(&texts, 1, "匆匆忙忙，连滚带爬");
    let mut surface = new_surface((900, 720));
    let canvas = surface.canvas();
    canvas.clear(Color::from_rgb(248, 247, 242));
    draw_centered(canvas, Rect::from_xywh(70.0, 55.0, 760.0, 70.0), "本来应该", 28.0, 46.0, Color::from_rgb(96, 106, 98), true)?;
    fill_round_rect(canvas, Rect::from_xywh(65.0, 135.0, 770.0, 190.0), 36.0, Color::from_rgb(217, 242, 222));
    draw_centered(canvas, Rect::from_xywh(100.0, 160.0, 700.0, 140.0), ideal, 36.0, 72.0, Color::from_rgb(31, 110, 63), true)?;
    draw_centered(canvas, Rect::from_xywh(70.0, 345.0, 760.0, 70.0), "现在是", 28.0, 46.0, Color::from_rgb(126, 95, 85), true)?;
    fill_round_rect(canvas, Rect::from_xywh(65.0, 425.0, 770.0, 190.0), 36.0, Color::from_rgb(255, 222, 214));
    draw_centered(canvas, Rect::from_xywh(100.0, 450.0, 700.0, 140.0), reality, 36.0, 72.0, Color::from_rgb(174, 47, 37), true)?;
    draw_optional_avatar(canvas, &images, 760, 626, 72);
    encode_png(surface.image_snapshot())
}

fn basic_not_basic(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    let subject = text_or(&texts, 0, "上班");
    finish_card(
        images,
        "基础不基础",
        &format!("{subject}基础\n{subject}就不基础"),
        "万能句式生成器",
        Color::from_rgb(242, 236, 255),
        Color::from_rgb(99, 63, 173),
        "？",
    )
}

fn spinning_cat(images: Vec<InputImage>, _: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    let func = |index: usize, frames: Vec<skia_safe::Image>| {
        let avatar = frames[0].circle().resize_exact((360, 360));
        let mut surface = new_surface((640, 640));
        let canvas = surface.canvas();
        canvas.clear(Color::from_rgb(255, 244, 215));
        fill_round_rect(canvas, Rect::from_xywh(28.0, 28.0, 584.0, 584.0), 48.0, Color::WHITE);
        let angle = index as f32 * (360.0 / 24.0);
        canvas.save();
        canvas.rotate(angle, Some(Point::new(320.0, 320.0)));
        let pulse = ((index as f32 / 24.0) * 2.0 * PI).sin();
        let offset = (pulse * 18.0) as i32;
        canvas.draw_image(&avatar, (140 + offset, 140 + offset), None);
        canvas.restore();
        draw_centered(canvas, Rect::from_xywh(70.0, 58.0, 500.0, 72.0), "OIIAI  OIIAI", 26.0, 48.0, Color::from_rgb(227, 104, 34), true)?;
        Ok(surface.image_snapshot())
    };
    make_gif_or_combined_gif(
        images,
        func,
        GifInfo { frame_num: 24, duration: 0.055 },
        FrameAlign::ExtendLoop,
    )
}

fn monthly_salary_cat(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    finish_card(
        images,
        "月薪喵",
        text_or(&texts, 0, "工资到账：喵的一声就没了"),
        "打工猫本月生存报告",
        Color::from_rgb(231, 248, 238),
        Color::from_rgb(38, 142, 89),
        "🐱 ¥",
    )
}

fn alive_feeling(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    finish_card(
        images,
        "活 人 感",
        text_or(&texts, 0, "不完美，但鲜活；没包装，但是真的"),
        "● REC  正在认真生活",
        Color::from_rgb(255, 238, 231),
        Color::from_rgb(225, 77, 57),
        "♥",
    )
}

fn steamer_city(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    finish_card(
        images,
        "蒸笼 CITY",
        text_or(&texts, 0, "今天不是出门，是上锅蒸熟"),
        "体感温度：马上出笼",
        Color::from_rgb(255, 231, 190),
        Color::from_rgb(227, 73, 41),
        "♨",
    )
}

fn dont_disturb_you(images: Vec<InputImage>, texts: Vec<String>, _: NoOptions) -> Result<Vec<u8>, Error> {
    finish_card(
        images,
        "勿扰吧你",
        text_or(&texts, 0, "消息看到了，暂时不想回"),
        "已开启温柔拒绝模式",
        Color::from_rgb(237, 240, 246),
        Color::from_rgb(71, 79, 99),
        "☾",
    )
}

register_meme!(
    "back_hand_opossum",
    back_hand_opossum,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 1,
    default_texts = &["我就看看，不说话"],
    keywords = &["背手负鼠", "领导视察", "老干部视察"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "sbti_result",
    sbti_result,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 2,
    default_texts = &["DEAD", "精神已死，但还能继续上班"],
    keywords = &["SBTI测试", "SBTI", "测测精神状态"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "niu_lai",
    niu_lai,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 1,
    default_texts = &["牛市来！好运来！"],
    keywords = &["牛来", "牛市来", "牛来保佑"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "hello_eat_some",
    hello_eat_some,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 1,
    default_texts = &["看起来很好吃，我就吃一点点"],
    keywords = &["你好我吃一点", "我吃一点"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "calm_unhurried",
    calm_unhurried,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 2,
    default_texts = &["从从容容，游刃有余", "匆匆忙忙，连滚带爬"],
    keywords = &["从从容容", "游刃有余", "连滚带爬"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "basic_not_basic",
    basic_not_basic,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 1,
    default_texts = &["上班"],
    keywords = &["基础不基础", "就不基础"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "spinning_cat_oiiai",
    spinning_cat,
    min_images = 1,
    max_images = 1,
    keywords = &["旋转猫", "OIIAI", "哈基米旋转"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "monthly_salary_cat",
    monthly_salary_cat,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 1,
    default_texts = &["工资到账：喵的一声就没了"],
    keywords = &["月薪喵"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "alive_feeling",
    alive_feeling,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 1,
    default_texts = &["不完美，但鲜活；没包装，但是真的"],
    keywords = &["活人感"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "steamer_city",
    steamer_city,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 1,
    default_texts = &["今天不是出门，是上锅蒸熟"],
    keywords = &["蒸笼city", "蒸笼City"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);

register_meme!(
    "dont_disturb_you",
    dont_disturb_you,
    min_images = 0,
    max_images = 1,
    min_texts = 0,
    max_texts = 1,
    default_texts = &["消息看到了，暂时不想回"],
    keywords = &["勿扰吧你"],
    date_created = local_date(2026, 9, 26),
    date_modified = local_date(2026, 9, 26),
);
